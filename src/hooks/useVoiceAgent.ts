import { useState, useEffect, useRef, useCallback } from 'react'
import type { AgentState, ConnectionState, MapActionPayload, Message, VoiceAgentConfig, ServerMessage } from '../lib/types'
import { useAudioRecorder } from './useAudioRecorder'
import { RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS, RECONNECT_MAX_ATTEMPTS } from '../lib/constants'

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
  micPermission: 'unknown' | 'granted' | 'denied' | 'requesting'
  micError: string | null
  streamingText: string          // agent text being revealed as its audio plays
  isStreaming: boolean           // true while agent audio + text reveal is happening
  partialTranscript: string      // the user's own words, growing live while they speak
  thinkingLabel: string | null   // tool-specific status while thinking, e.g. "Charting course..."
  mapAction: MapActionPayload | null
  muted: boolean
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  toggleMute: () => void
  interrupt: () => void
  sendText: (text: string) => void
  clearMessages: () => void
  clearMapAction: () => void
  unlockAudio: () => void
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
  const [muted, setMuted] = useState(false)

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

  // Live-transcription forwarding — true only once real speech has been
  // detected in the current mic-open session (see handleSpeechStart below).
  const isForwardingRef = useRef(false)
  const chunkChainRef = useRef<Promise<void>>(Promise.resolve())

  // Pending agent text (arrives before audio)
  const pendingAgentTextRef = useRef<string | null>(null)

  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { agentStateRef.current = agentState }, [agentState])

  const recorder = useAudioRecorder()
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
    setStreamingText('')
    setIsStreaming(true)

    const chars = Array.from(text)
    const total = chars.length
    if (total === 0) { setIsStreaming(false); onDone(); return }

    const msPerChar = Math.max(20, durationMs / total)
    let i = 0

    streamIntervalRef.current = setInterval(() => {
      i++
      setStreamingText(chars.slice(0, i).join(''))
      if (i >= total) {
        clearStream()
        onDone()
      }
    }, msPerChar)
  }, [clearStream])

  // ─── Audio playback queue ───────────────────────────────────────────
  const playNextAudio = useCallback(async () => {
    const next = audioQueueRef.current.shift()
    if (!next) {
      isPlayingRef.current = false
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
        setStreamingText('')
        setIsStreaming(false)
      })
    }

    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      let ctx = audioCtxRef.current
      if (!ctx || ctx.state === 'closed') { ctx = new AudioContext(); audioCtxRef.current = ctx }
      if (ctx.state === 'suspended') await ctx.resume()

      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0))
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => { currentSourceRef.current = null; playNextAudio() }
      currentSourceRef.current = source
      source.start(0)
    } catch (e) {
      console.error('Audio playback error:', e)
      playNextAudio()
    }
  }, [streamText])

  const enqueueAudio = useCallback((base64: string) => {
    const text = pendingAgentTextRef.current ?? ''
    pendingAgentTextRef.current = null
    audioQueueRef.current.push({ base64, text })
    // Hold playback until the user has accepted the mic permission prompt —
    // queued audio is flushed once that happens (see startListening).
    if (micGrantedRef.current && !isPlayingRef.current) playNextAudio()
  }, [playNextAudio])

  // Barge-in: let the user cut the agent off mid-speech.
  const interrupt = useCallback(() => {
    audioQueueRef.current = []
    pendingAgentTextRef.current = null
    clearStream()
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
    setAgentState('idle')
  }, [clearStream])

  // ─── WebSocket ──────────────────────────────────────────────────────
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
        ws.send(JSON.stringify({ type: 'config', language: configRef.current.language, userId: configRef.current.userId }))
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!isMountedRef.current) return
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage
          switch (msg.type) {
            case 'transcript':
              if (msg.role === 'user') {
                setPartialTranscript('')
                setMessages(prev => [...prev, {
                  id: `${Date.now()}-${Math.random()}`,
                  role: 'user',
                  text: msg.text,
                  timestamp: new Date(),
                  language: configRef.current.language,
                }])
              } else {
                // Buffer agent text — reveal it when audio arrives
                pendingAgentTextRef.current = msg.text
              }
              break
            case 'partial_transcript':
              // Live growing transcript of the user's own speech, before they've stopped talking.
              setPartialTranscript(msg.text)
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
  }, [enqueueAudio, scheduleReconnect])

  useEffect(() => {
    isMountedRef.current = true
    connect()
    return () => {
      isMountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      clearStream()
      wsRef.current?.close()
      audioCtxRef.current?.close()
    }
  }, [connect, clearStream])

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'config', language: config.language, userId: config.userId }))
    }
  }, [config.language, config.userId])

  // ─── Live-streamed chunk forwarding ───────────────────────────────────
  // The recorder only ever starts producing chunks once real speech has been
  // detected (see useAudioRecorder), so every chunk it hands us here belongs
  // to the current utterance — just relay them to the server in strict order.
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
    if (agentStateRef.current === 'speaking') interrupt()
    setAgentState('listening')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio_start', language: configRef.current.language }))
    }
  }, [interrupt])

  // ─── Mic monitoring / continuous listening ───────────────────────────
  const stopListening = useCallback(async () => {
    if (!isForwardingRef.current) return
    isForwardingRef.current = false
    stopListeningRef.current = null
    setAgentState('thinking')
    try { await recorder.stop() } catch { /* already stopped */ }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'audio_end' }))
    } else {
      setAgentState('idle')
    }
  }, [recorder])

  useEffect(() => { stopListeningRef.current = stopListening }, [stopListening])

  // Opens the mic and starts VAD monitoring. `silent` keeps the visible state
  // as-is (used to open the mic proactively while the agent is speaking, for
  // barge-in) — otherwise the state flips to 'listening' once the mic is open.
  const startListening = useCallback(async (opts?: { silent?: boolean }) => {
    if (recorder.isRecording) {
      if (!opts?.silent) setAgentState('listening')
      return
    }
    if (listeningStartInFlightRef.current) return
    listeningStartInFlightRef.current = true
    try {
      await recorder.start({
        onSpeechStart: handleSpeechStart,
        onSilence: () => { stopListeningRef.current?.() },
        onChunk: handleChunk,
        // While the agent is talking, the mic can easily pick up its own
        // voice through the speakers (no headphones). Require noticeably
        // louder, sustained audio before treating it as a real interruption
        // — a normal listening turn stays fast/instant-triggered.
        ...(opts?.silent ? { speechThreshold: 0.18, speechSustainMs: 180 } : {}),
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
  }, [recorder, unlockAudio, playNextAudio, handleSpeechStart, handleChunk])

  // Keep the mic proactively open (and thus VAD-monitored for barge-in)
  // whenever the agent is idle or speaking and the user hasn't muted —
  // this is what turns tap-to-talk into an always-on voice mode.
  useEffect(() => {
    if (muted) return
    if (connectionState !== 'connected') return
    if (agentState === 'idle') { startListening(); return }
    if (agentState === 'speaking') { startListening({ silent: true }); return }
  }, [agentState, connectionState, muted, startListening])

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      if (next && recorder.isRecording) {
        isForwardingRef.current = false
        setPartialTranscript('')
        recorder.stop().catch(() => {})
        if (agentStateRef.current === 'listening') setAgentState('idle')
      }
      return next
    })
  }, [recorder])

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (recorder.isRecording) {
      isForwardingRef.current = false
      setPartialTranscript('')
      recorder.stop().catch(() => {})
    }
    setAgentState('thinking')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed, language: configRef.current.language }))
    } else {
      setAgentState('idle')
    }
  }, [recorder])

  const clearMessages = useCallback(() => setMessages([]), [])
  const clearMapAction = useCallback(() => setMapAction(null), [])

  return {
    agentState, connectionState, messages,
    isConnected: connectionState === 'connected',
    audioLevel: recorder.audioLevel,
    micPermission: recorder.permissionState,
    micError: recorder.error,
    streamingText, isStreaming, partialTranscript, thinkingLabel,
    mapAction, clearMapAction,
    muted, toggleMute, interrupt, sendText,
    startListening, stopListening, clearMessages, unlockAudio,
  }
}
