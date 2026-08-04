import { useState, useEffect, useRef, useCallback } from 'react'
import type { AgentState, CheckpointPrompt, ConnectionState, MapActionPayload, Message, VoiceAgentConfig, VoiceSettings, ServerMessage } from '../lib/types'
import { useAudioRecorder } from './useAudioRecorder'
import {
  RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS, RECONNECT_MAX_ATTEMPTS,
  LISTENING_START_SOUND_URL, LISTENING_STOP_SOUND_URL,
} from '../lib/constants'

// Listening-start/stop chime volume — cut 60% from the source file's level.
const CHIME_GAIN = 0.4

// Shortest gap between two attempts to rebuild a mic that reported itself
// dead. Long enough that a hopeless mic retries quietly in the background,
// short enough that a transient glitch is recovered before the user notices.
const MIC_RECOVERY_COOLDOWN_MS = 3000

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64 === undefined) reject(new Error('Failed to convert blob to base64'))
      else resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Estimate MP3 duration from base64 length (128kbps)
function estimateDurationMs(base64: string): number {
  const bytes = Math.floor(base64.length * 0.75)
  return Math.max(1000, (bytes / 16000) * 1000)
}

export interface VoiceAgentHook {
  agentState: AgentState
  connectionState: ConnectionState
  messages: Message[]
  isConnected: boolean
  audioLevel: number
  agentOutputLevel: number
  micPermission: 'unknown' | 'granted' | 'denied' | 'requesting'
  micError: string | null
  streamingText: string          // agent text being revealed as its audio plays
  isStreaming: boolean           // true while agent audio + text reveal is happening
  partialTranscript: string      // the user's own words, growing live while they speak
  thinkingLabel: string | null   // tool-specific status while thinking, e.g. "Charting course..."
  mapAction: MapActionPayload | null
  checkpointPrompt: CheckpointPrompt | null
  muted: boolean
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  toggleMute: () => void
  interrupt: () => void
  sendText: (text: string) => void
  clearMessages: () => void
  clearMapAction: () => void
  unlockAudio: () => void
  sendLocation: (lat: number, lng: number, accuracy: number) => void
  confirmCheckpoint: () => void
  requestCheckpointHelp: () => void
  detectedLanguage: string | null   // auto mode: what the server last heard
  memoryPersisted: boolean | null   // server's verdict: is this session's memory durable?
  changeLanguage: (lang: string) => void
  /** Retunes the voice for everything spoken from here on. Nothing already
   *  playing is regenerated — a slider isn't worth interrupting a sentence. */
  setVoice: (voice: VoiceSettings) => void
}

export function useVoiceAgent(config: VoiceAgentConfig): VoiceAgentHook {
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [partialTranscript, setPartialTranscript] = useState('')
  const [thinkingLabel, setThinkingLabel] = useState<string | null>(null)
  const [mapAction, setMapAction] = useState<MapActionPayload | null>(null)
  const [checkpointPrompt, setCheckpointPrompt] = useState<CheckpointPrompt | null>(null)
  const [muted, setMuted] = useState(false)
  // Auto mode: what the server last heard. Null until someone speaks.
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  // Whether the SERVER accepted our access token — i.e. whether anything said
  // this session will actually be remembered. Null until it has told us.
  const [memoryPersisted, setMemoryPersisted] = useState<boolean | null>(null)
  const [agentOutputLevel, setAgentOutputLevel] = useState(0)
  // Bumped after a stalled mic has been torn down, purely to re-run the
  // keep-the-mic-open effect below once the hardware is free again.
  const [micRestartTick, setMicRestartTick] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const configRef = useRef(config)
  const agentStateRef = useRef<AgentState>('idle')

  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<Array<{ base64: string; text: string }>>([])
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const listeningStartInFlightRef = useRef(false)
  const micGrantedRef = useRef(false)
  const micStallRecoveryRef = useRef(false)
  const lastMicRecoveryRef = useRef(0)

  // Analyser sits inline in the *playback* graph (source -> analyser ->
  // destination) so the orb can pulse its radius to the agent's own voice,
  // not the mic's — audioLevel above is mic-only and stays silent while the
  // agent talks over closed-mic playback.
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null)
  const playbackLevelFrameRef = useRef<number | null>(null)
  const smoothedOutputLevelRef = useRef(0)
  const prevAgentStateRef = useRef<AgentState>('idle')
  // Decoded once per URL and cached — see playSound below for why these ride
  // on audioCtxRef instead of separate <audio> elements.
  const sfxBuffersRef = useRef<Record<string, AudioBuffer | null>>({})
  const sfxLoadingRef = useRef<Record<string, Promise<AudioBuffer> | undefined>>({})

  // Live-transcription forwarding — true only once real speech has been
  // detected in the current mic-open session (see handleSpeechStart below).
  const isForwardingRef = useRef(false)
  const chunkChainRef = useRef<Promise<void>>(Promise.resolve())
  // Whether incoming partial transcripts still belong to an utterance the user
  // is in the middle of. Opened by handleSpeechStart, closed by the final
  // transcript — see the partial_transcript case above.
  const acceptPartialsRef = useRef(false)

  // Pending agent text (arrives before audio)
  const pendingAgentTextRef = useRef<string | null>(null)
  // Full text of the turn currently being spoken — not just the part revealed
  // so far — so a mid-speech language switch can replay all of it.
  const speakingTextRef = useRef('')
  // Committed history, readable from callbacks without making them depend on
  // (and be recreated by) every message that lands.
  const messagesRef = useRef<Message[]>([])
  // Mirrors streamingText so interrupt() can read the just-revealed portion
  // without depending on (and being recreated alongside) fast-changing state.
  const streamingTextRef = useRef('')

  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { agentStateRef.current = agentState }, [agentState])
  useEffect(() => { messagesRef.current = messages }, [messages])

  const recorder = useAudioRecorder()
  // The recorder hands back a fresh wrapper object on every render, and it
  // re-renders on every animation frame (audioLevel). Depending on the object
  // would rebuild every callback below at 60fps and re-fire the keep-the-mic-
  // open effect just as often; its methods are stable, so depend on those.
  const { start: startRecorder, stop: stopRecorder } = recorder
  const stopListeningRef = useRef<(() => Promise<void>) | null>(null)

  // ─── Audio unlock ───────────────────────────────────────────────────
  const unlockAudio = useCallback(() => {
    if (audioCtxRef.current) return
    const ctx = new AudioContext()
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
    audioCtxRef.current = ctx
  }, [])

  // ─── Text streaming ─────────────────────────────────────────────────
  const clearStream = useCallback(() => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current)
      streamIntervalRef.current = null
    }
  }, [])

  const streamText = useCallback((text: string, durationMs: number, onDone: () => void) => {
    clearStream()
    streamingTextRef.current = ''
    setStreamingText('')
    setIsStreaming(true)

    const chars = Array.from(text)
    const total = chars.length
    if (total === 0) { setIsStreaming(false); onDone(); return }

    const msPerChar = Math.max(20, durationMs / total)
    let i = 0

    streamIntervalRef.current = setInterval(() => {
      i++
      const revealed = chars.slice(0, i).join('')
      streamingTextRef.current = revealed
      setStreamingText(revealed)
      if (i >= total) {
        clearStream()
        onDone()
      }
    }, msPerChar)
  }, [clearStream])

  // ─── Agent-voice output level (drives the orb's speaking pulse) ─────
  const stopOutputLevelMonitor = useCallback(() => {
    if (playbackLevelFrameRef.current !== null) {
      cancelAnimationFrame(playbackLevelFrameRef.current)
      playbackLevelFrameRef.current = null
    }
    setAgentOutputLevel(0)
    smoothedOutputLevelRef.current = 0
  }, [])

  const startOutputLevelMonitor = useCallback(() => {
    if (playbackLevelFrameRef.current !== null) return // already ticking
    const dataArray = new Float32Array(512)
    const tick = () => {
      const analyser = playbackAnalyserRef.current
      if (!analyser) { playbackLevelFrameRef.current = null; return }
      analyser.getFloatTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i]
      const rms = Math.sqrt(sum / dataArray.length)
      // Typical speech RMS rarely gets near the ceiling, so a plain linear
      // gain leaves the orb's pulse looking almost flat. Push it harder and
      // bend the curve (sqrt) so normal speaking volume already sits close
      // to 1 instead of only the loudest syllables, then smooth frame-to-frame
      // so the pulse reads as a breathing motion rather than raw-RMS jitter.
      const boosted = Math.min(1, rms * 9)
      const shaped = Math.sqrt(boosted)
      smoothedOutputLevelRef.current += (shaped - smoothedOutputLevelRef.current) * 0.35
      setAgentOutputLevel(smoothedOutputLevelRef.current)
      playbackLevelFrameRef.current = requestAnimationFrame(tick)
    }
    playbackLevelFrameRef.current = requestAnimationFrame(tick)
  }, [])

  // Cue sounds marking VAD state transitions: one the instant the user's
  // speech is confirmed (entering 'listening'), the other the instant they
  // stop and the turn hands off to the agent (leaving 'listening' for
  // 'thinking'). Played as decoded buffers through audioCtxRef — the same
  // AudioContext the TTS playback already uses — instead of a bare `new
  // Audio(src).play()`. iOS Safari blocks that unless the exact element has
  // previously played inside a direct user-gesture handler; these fire from
  // a VAD/timer callback, not a gesture, so a fresh <audio> element gets
  // silently rejected. audioCtxRef is unlocked once, during the mic-permission
  // gesture in startListening, and everything scheduled through it afterwards
  // (buffers or nodes) keeps playing — exactly how agent speech works today.
  const loadSfxBuffer = useCallback(async (ctx: AudioContext, url: string): Promise<AudioBuffer | null> => {
    const cached = sfxBuffersRef.current[url]
    if (cached) return cached
    if (!sfxLoadingRef.current[url]) {
      sfxLoadingRef.current[url] = fetch(url)
        .then(r => r.arrayBuffer())
        .then(ab => ctx.decodeAudioData(ab))
    }
    try {
      const buffer = await sfxLoadingRef.current[url]
      if (buffer) sfxBuffersRef.current[url] = buffer
      return buffer ?? null
    } catch {
      sfxLoadingRef.current[url] = undefined
      return null
    }
  }, [])

  const playSound = useCallback(async (url: string) => {
    let ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return // not unlocked yet — nothing safe to play through
    if (ctx.state === 'suspended') { try { await ctx.resume() } catch { /* stay silent */ } }
    const buffer = await loadSfxBuffer(ctx, url)
    if (!buffer) return
    ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = CHIME_GAIN
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start(0)
  }, [loadSfxBuffer])

  useEffect(() => {
    const prev = prevAgentStateRef.current
    if (agentState === 'listening' && prev !== 'listening') {
      playSound(LISTENING_START_SOUND_URL)
    } else if (prev === 'listening' && agentState === 'thinking') {
      playSound(LISTENING_STOP_SOUND_URL)
    }
    prevAgentStateRef.current = agentState
  }, [agentState, playSound])

  // ─── Audio playback queue ───────────────────────────────────────────
  const playNextAudio = useCallback(async () => {
    const next = audioQueueRef.current.shift()
    if (!next) {
      isPlayingRef.current = false
      stopOutputLevelMonitor()
      if (isMountedRef.current) {
        setAgentState('idle')
        setIsStreaming(false)
        setStreamingText('')
      }
      return
    }

    isPlayingRef.current = true
    if (isMountedRef.current) setAgentState('speaking')

    const { base64, text } = next
    speakingTextRef.current = text
    const durationMs = estimateDurationMs(base64)

    // Stream text in parallel with audio
    if (isMountedRef.current) {
      streamText(text, durationMs, () => {
        if (!isMountedRef.current) return
        // Move to messages when text reveal is done
        const msg: Message = {
          id: `${Date.now()}-${Math.random()}`,
          role: 'agent',
          text,
          timestamp: new Date(),
          language: configRef.current.language,
        }
        setMessages(prev => [...prev, msg])
        streamingTextRef.current = ''
        setStreamingText('')
        setIsStreaming(false)
      })
    }

    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      let ctx = audioCtxRef.current
      if (!ctx || ctx.state === 'closed') { ctx = new AudioContext(); audioCtxRef.current = ctx; playbackAnalyserRef.current = null }
      if (ctx.state === 'suspended') await ctx.resume()

      if (!playbackAnalyserRef.current) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.connect(ctx.destination)
        playbackAnalyserRef.current = analyser
      }
      startOutputLevelMonitor()

      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0))
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(playbackAnalyserRef.current)
      source.onended = () => { currentSourceRef.current = null; playNextAudio() }
      currentSourceRef.current = source
      source.start(0)
    } catch (e) {
      console.error('Audio playback error:', e)
      playNextAudio()
    }
  }, [streamText, startOutputLevelMonitor])

  const enqueueAudio = useCallback((base64: string) => {
    const text = pendingAgentTextRef.current ?? ''
    pendingAgentTextRef.current = null
    audioQueueRef.current.push({ base64, text })
    // Hold playback until the user has accepted the mic permission prompt —
    // queued audio is flushed once that happens (see startListening).
    if (micGrantedRef.current && !isPlayingRef.current) playNextAudio()
  }, [playNextAudio])

  // Tear down playback without deciding what happens to the text — barge-in
  // keeps the cut-off half, a language switch throws it away and replays the
  // whole turn, so that call belongs to the caller.
  const stopPlayback = useCallback(() => {
    audioQueueRef.current = []
    pendingAgentTextRef.current = null
    clearStream()
    streamingTextRef.current = ''
    setStreamingText('')
    setIsStreaming(false)
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null
        currentSourceRef.current.stop()
      } catch { /* already stopped */ }
      currentSourceRef.current = null
    }
    isPlayingRef.current = false
    stopOutputLevelMonitor()
    setAgentState('idle')
  }, [clearStream, stopOutputLevelMonitor])

  // Barge-in: let the user cut the agent off mid-speech.
  const interrupt = useCallback(() => {
    audioQueueRef.current = []
    pendingAgentTextRef.current = null
    clearStream()
    // Whatever text had already been revealed stays in the conversation —
    // just marked as cut off — rather than vanishing when the user barges in.
    const revealed = streamingTextRef.current.trim()
    if (revealed) {
      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        role: 'agent',
        text: `${revealed}—`,
        timestamp: new Date(),
        language: configRef.current.language,
      }])
    }
    streamingTextRef.current = ''
    setStreamingText('')
    setIsStreaming(false)
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.onended = null
        currentSourceRef.current.stop()
      } catch { /* already stopped */ }
      currentSourceRef.current = null
    }
    isPlayingRef.current = false
    stopOutputLevelMonitor()
    setAgentState('idle')
  }, [clearStream, stopOutputLevelMonitor])

  // Switching language mid-conversation: cut whatever is playing, and if
  // something was, have the server produce that answer again in the new
  // language. Text already on screen stays as it was spoken — it's a record of
  // what was actually said, and rewriting it after the fact would misreport
  // the conversation.
  const changeLanguage = useCallback((lang: string) => {
    const wasSpeaking = isPlayingRef.current || audioQueueRef.current.length > 0
    if (wasSpeaking) stopPlayback()
    speakingTextRef.current = ''
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'set_language', language: lang, resume: wasSpeaking }))
  }, [stopPlayback])

  // ─── WebSocket ──────────────────────────────────────────────────────
  // Whether this connection has been told who it's talking to yet. Reset on
  // every open, because a reconnect starts a fresh server-side session.
  const configSentRef = useRef(false)

  const sendConfig = useCallback((greet: boolean): boolean => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({
      type: 'config',
      language: configRef.current.language,
      userId: configRef.current.userId,
      accessToken: configRef.current.accessToken ?? null,
      voice: configRef.current.voice,
      greet,
    }))
    return true
  }, [])

  /** Push the sliders to the server. Silently a no-op while the socket is
   *  down — the value is already in configRef, so the reconnect's config
   *  carries it and nothing is lost. */
  const setVoice = useCallback((voice: VoiceSettings) => {
    const ws = wsRef.current
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'set_voice', voice }))
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (!isMountedRef.current) return
    if (reconnectAttemptsRef.current >= RECONNECT_MAX_ATTEMPTS) {
      setConnectionState('disconnected'); return
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current),
      RECONNECT_MAX_DELAY_MS
    )
    reconnectAttemptsRef.current += 1
    setConnectionState('reconnecting')
    reconnectTimerRef.current = setTimeout(() => { if (isMountedRef.current) connect() }, delay)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    if (!isMountedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    setConnectionState('connecting')

    try {
      const ws = new WebSocket(configRef.current.serverUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMountedRef.current) return
        reconnectAttemptsRef.current = 0
        setConnectionState('connected')
        setAgentState('idle')
        // Held back until we know who this is. A stored session is read from
        // disk asynchronously, and configuring the socket before that resolves
        // would have the server greet a returning, signed-in traveler as a
        // stranger. The identity effect below sends it the moment auth settles.
        configSentRef.current = false
        if (configRef.current.authReady !== false) {
          // Only greet on a genuinely fresh session — onopen also fires on
          // every reconnect, and re-greeting there talks over an ongoing
          // conversation.
          configSentRef.current = sendConfig(messagesRef.current.length === 0)
        }
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!isMountedRef.current) return
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage
          switch (msg.type) {
            case 'transcript':
              if (msg.role === 'user') {
                // The words that go into the conversation are also the words
                // left under the orb — the caption isn't cleared here, it's
                // overwritten with this exact text. Anything the interim
                // hypothesis had guessed differently is corrected on screen at
                // the same instant it's committed to history, so the two can
                // never show the user two different sentences.
                setPartialTranscript(msg.text)
                acceptPartialsRef.current = false
                setMessages(prev => [...prev, {
                  id: `${Date.now()}-${Math.random()}`,
                  role: 'user',
                  text: msg.text,
                  timestamp: new Date(),
                  language: configRef.current.language,
                }])
              } else {
                // Buffer agent text — reveal it when audio arrives. The user's
                // words stay under the orb right up to this point (through the
                // whole "thinking" stretch, so they can see what was heard) and
                // hand over to the reply here.
                pendingAgentTextRef.current = msg.text
                setPartialTranscript('')
                acceptPartialsRef.current = false
              }
              break
            case 'partial_transcript':
              // Live transcript of the user's own speech. Deepgram revises its
              // hypothesis as more audio arrives, and the revision is the
              // better transcript ("in a coffee shop near" → "and a coffee
              // shop nearby.") — so it's applied verbatim rather than being
              // filtered for monotonic growth, which used to pin a superseded
              // guess on screen while the corrected one went into history.
              //
              // Staleness is handled by ownership instead: partials are only
              // accepted between this utterance's speech-start and the final
              // transcript that closes it. A result that arrives after that —
              // a late flush from the turn just committed — is dropped.
              if (!acceptPartialsRef.current) break
              setPartialTranscript(msg.text)
              if (msg.final) acceptPartialsRef.current = false
              break
            case 'audio':
              enqueueAudio(msg.data)
              break
            case 'status':
              // Ignore server-sent idle/speaking while we're locally playing audio —
              // our playback queue controls when we return to idle.
              if (isPlayingRef.current || audioQueueRef.current.length > 0) break
              setAgentState(msg.state)
              setThinkingLabel(msg.state === 'thinking' ? (msg.label ?? null) : null)
              break
            case 'error':
              setPartialTranscript('')
              acceptPartialsRef.current = false
              setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: 'agent',
                text: msg.message,
                timestamp: new Date(),
              }])
              setAgentState('idle')
              break
            case 'map_action':
              if (msg.action.type === 'clear') {
                setMapAction(null)
              } else {
                setMapAction(msg.action)
              }
              break
            case 'checkpoint_prompt':
              setCheckpointPrompt({
                routeId: msg.routeId,
                segmentIndex: msg.segmentIndex,
                stopIndex: msg.stopIndex,
                poiName: msg.poiName,
                promptText: msg.promptText,
                gpsTarget: msg.gpsTarget,
              })
              break
            case 'checkpoint_resolved':
              setCheckpointPrompt(prev =>
                prev && prev.routeId === msg.routeId && prev.segmentIndex === msg.segmentIndex && prev.stopIndex === msg.stopIndex
                  ? null
                  : prev
              )
              break
            case 'language_detected':
              setDetectedLanguage(msg.language)
              break
            case 'account':
              setMemoryPersisted(msg.signedIn)
              break
          }
        } catch { /* ignore malformed */ }
      }

      ws.onclose = () => {
        if (!isMountedRef.current) return
        setConnectionState('disconnected')
        setAgentState('idle')
        scheduleReconnect()
      }
      ws.onerror = () => { /* onclose handles reconnect */ }
    } catch {
      setConnectionState('disconnected')
      scheduleReconnect()
    }
  }, [enqueueAudio, scheduleReconnect, sendConfig])

  useEffect(() => {
    isMountedRef.current = true
    connect()
    return () => {
      isMountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      clearStream()
      stopOutputLevelMonitor()
      wsRef.current?.close()
      audioCtxRef.current?.close()
    }
  }, [connect, clearStream, stopOutputLevelMonitor])

  // Identity only. Language changes go through changeLanguage(), which also has
  // to stop playback and retranslate the transcript — re-sending config here
  // would race that with a second, dumber switch.
  //
  // This is what makes signing in mid-conversation seamless: the socket, the
  // transcript, and whatever the agent is in the middle of all stay put, and
  // the server simply re-resolves who it's talking to and loads their saved
  // preferences. It also covers the first config of a connection when auth was
  // still resolving at the time the socket opened — hence greeting here, but
  // only when this is genuinely the opening exchange.
  const identityKey = `${config.userId ?? ''}|${config.accessToken ?? ''}`
  const lastIdentityRef = useRef(identityKey)
  useEffect(() => {
    if (config.authReady === false) return
    if (configSentRef.current && lastIdentityRef.current === identityKey) return
    const isFirstForThisConnection = !configSentRef.current
    if (sendConfig(isFirstForThisConnection && messagesRef.current.length === 0)) {
      configSentRef.current = true
      lastIdentityRef.current = identityKey
    }
  }, [identityKey, config.authReady, sendConfig])

  // ─── Live-streamed chunk forwarding ───────────────────────────────────
  // The recorder only ever hands us chunks once real speech has been detected
  // (buffered lead-in audio included — see useAudioRecorder), so every chunk
  // here belongs to the current utterance — relay them in strict order.
  // stopListening awaits this chain before sending audio_end, so the final
  // chunk's async base64/send can never race behind that message.
  const handleChunk = useCallback((blob: Blob) => {
    chunkChainRef.current = chunkChainRef.current.then(async () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return
      try {
        const base64 = await blobToBase64(blob)
        wsRef.current.send(JSON.stringify({ type: 'audio_chunk', data: base64 }))
      } catch { /* drop this chunk */ }
    })
  }, [])

  // Fires the instant the VAD detects the user has started talking — this is
  // what makes both continuous listening and mid-speech barge-in possible.
  const handleSpeechStart = useCallback(() => {
    isForwardingRef.current = true
    acceptPartialsRef.current = true
    if (agentStateRef.current === 'speaking') interrupt()
    setAgentState('listening')
    setPartialTranscript('') // clear the previous turn's words; this one starts blank
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio_start', language: configRef.current.language }))
    }
  }, [interrupt])

  // ─── Mic monitoring / continuous listening ───────────────────────────
  const stopListening = useCallback(async () => {
    // isForwardingRef is the re-entry guard; the ref below is deliberately not
    // nulled here. The VAD's onSilence callback dereferences it on every
    // utterance, and clearing it left the mic with no way to end a turn until
    // some unrelated render happened to restore it.
    if (!isForwardingRef.current) return
    isForwardingRef.current = false
    setAgentState('thinking')
    try { await stopRecorder() } catch { /* already stopped */ }
    // recorder.stop() resolves once the MediaRecorder's 'stop' event fires,
    // but the final chunk's base64-encode-then-send is queued asynchronously
    // on chunkChainRef (see handleChunk) and may not have gone out yet.
    // Wait for it, or audio_end can reach the server first and finalize the
    // transcript before those last words ever arrive — dropping them even
    // though they were captured.
    await chunkChainRef.current
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio_end' }))
    } else {
      setAgentState('idle')
    }
  }, [stopRecorder])

  // Kept current on every render, not just when the identity changes — the
  // recorder holds this indirection for the life of the mic session.
  useEffect(() => { stopListeningRef.current = stopListening })

  // The mic went dead while still nominally open — an OS/browser-level
  // failure the page can't prevent, only notice. Rebuild it rather than
  // leaving the user talking into a mic that stopped listening minutes ago
  // (which is what made toggling mute look like the fix: it was a rebuild).
  const handleMicStalled = useCallback(() => {
    if (micStallRecoveryRef.current) return
    // A mic that fails the moment it opens (revoked permission, no input
    // device, the OS handing it to another app) would otherwise restart in a
    // tight loop. Rate-limit recovery so a persistently broken mic degrades
    // to periodic retries instead of spinning.
    const now = Date.now()
    if (now - lastMicRecoveryRef.current < MIC_RECOVERY_COOLDOWN_MS) return
    lastMicRecoveryRef.current = now
    micStallRecoveryRef.current = true
    console.warn('Microphone stalled — reopening')
    isForwardingRef.current = false
    stopRecorder()
      .catch(() => {})
      .finally(() => {
        micStallRecoveryRef.current = false
        // Re-entry through the keep-open effect below: it already knows
        // whether we should be listening at all right now (muted? connected?).
        setAgentState(prev => (prev === 'listening' ? 'idle' : prev))
        setMicRestartTick(t => t + 1)
      })
  }, [stopRecorder])

  // Opens the mic and starts VAD monitoring. `silent` keeps the visible state
  // as-is (used to open the mic proactively while the agent is speaking, for
  // barge-in) — otherwise the state flips to 'listening' once the mic is open.
  const startListening = useCallback(async (opts?: { silent?: boolean }) => {
    if (listeningStartInFlightRef.current) return
    listeningStartInFlightRef.current = true
    try {
      // start() is safe to call on an already-open mic: it retunes the VAD and
      // refreshes the callbacks in place. That matters because the mic is
      // opened in 'bargein' mode under the agent's voice and has to come back
      // down to 'normal' the moment the agent stops — previously this branch
      // early-returned, so after the first reply the mic stayed pinned at the
      // loud barge-in threshold and quiet speech was never heard again.
      await startRecorder({
        onSpeechStart: handleSpeechStart,
        onSilence: () => { stopListeningRef.current?.() },
        onChunk: handleChunk,
        onStalled: handleMicStalled,
        // While the agent is talking, the mic can easily pick up its own
        // voice through the speakers (no headphones). Require noticeably
        // louder, sustained audio before treating it as a real interruption
        // — a normal listening turn stays fast/instant-triggered.
        mode: opts?.silent ? 'bargein' : 'normal',
      })

      if (!micGrantedRef.current) {
        // First-ever grant: this permission prompt is the user gesture that
        // unlocks playback — release any agent audio that arrived earlier.
        micGrantedRef.current = true
        unlockAudio()
        if (audioQueueRef.current.length > 0 && !isPlayingRef.current) {
          playNextAudio()
          return
        }
      }

      if (!opts?.silent) setAgentState('listening')
    } catch {
      if (!opts?.silent) setAgentState('error')
    } finally {
      listeningStartInFlightRef.current = false
    }
  }, [startRecorder, unlockAudio, playNextAudio, handleSpeechStart, handleChunk, handleMicStalled])

  // Keep the mic proactively open (and thus VAD-monitored for barge-in)
  // whenever the agent is idle or speaking and the user hasn't muted —
  // this is what turns tap-to-talk into an always-on voice mode.
  //
  // 'listening' is included deliberately: the mic being open is what puts us
  // in that state, but a stall recovery can leave the state and the hardware
  // out of step, and this is what puts them back together.
  useEffect(() => {
    if (muted) return
    if (connectionState !== 'connected') return
    if (agentState === 'speaking') { startListening({ silent: true }); return }
    if (agentState === 'idle' || agentState === 'listening') { startListening(); return }
  }, [agentState, connectionState, muted, startListening, micRestartTick])

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      if (next) {
        isForwardingRef.current = false
        acceptPartialsRef.current = false
        setPartialTranscript('')
        stopRecorder().catch(() => {})
        if (agentStateRef.current === 'listening') setAgentState('idle')
      }
      return next
    })
  }, [stopRecorder])

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    isForwardingRef.current = false
    acceptPartialsRef.current = false
    setPartialTranscript('')
    stopRecorder().catch(() => {})
    setAgentState('thinking')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed, language: configRef.current.language }))
    } else {
      setAgentState('idle')
    }
  }, [stopRecorder])

  const clearMessages = useCallback(() => setMessages([]), [])
  const clearMapAction = useCallback(() => setMapAction(null), [])

  // Streamed opportunistically as the device moves — throttled by the caller
  // (useGeolocation's watchPosition callback), not on every render.
  const sendLocation = useCallback((lat: number, lng: number, accuracy: number) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'location', lat, lng, accuracy, timestamp: Date.now() }))
  }, [])

  // Tapping either checkpoint pill behaves exactly like the user having said
  // it out loud: cut the agent off if it's mid-sentence, play the same
  // listening-start chime a real utterance would, and send it as a normal
  // text turn (shows up in the transcript, goes through the same LLM
  // judgment as speech) — no special "synthetic turn" plumbing that the
  // model has to interpret differently from a real message.
  const confirmCheckpoint = useCallback(() => {
    const prompt = checkpointPrompt
    if (!prompt) return
    setCheckpointPrompt(null)
    if (agentStateRef.current === 'speaking') interrupt()
    playSound(LISTENING_START_SOUND_URL)
    sendText(`Made it to ${prompt.poiName}.`)
  }, [checkpointPrompt, interrupt, playSound, sendText])

  // "Need help" doesn't clear the pending checkpoint (the user hasn't
  // resolved it) — otherwise behaves the same as confirmCheckpoint.
  const requestCheckpointHelp = useCallback(() => {
    const prompt = checkpointPrompt
    if (!prompt) return
    if (agentStateRef.current === 'speaking') interrupt()
    playSound(LISTENING_START_SOUND_URL)
    sendText(`I need help finding ${prompt.poiName}.`)
  }, [checkpointPrompt, interrupt, playSound, sendText])

  return {
    agentState, connectionState, messages,
    isConnected: connectionState === 'connected',
    audioLevel: recorder.audioLevel,
    agentOutputLevel,
    micPermission: recorder.permissionState,
    micError: recorder.error,
    streamingText, isStreaming, partialTranscript, thinkingLabel,
    mapAction, clearMapAction,
    checkpointPrompt, confirmCheckpoint, requestCheckpointHelp,
    muted, toggleMute, interrupt, sendText,
    startListening, stopListening, clearMessages, unlockAudio,
    sendLocation,
    detectedLanguage, memoryPersisted, changeLanguage,
    setVoice,
  }
}
