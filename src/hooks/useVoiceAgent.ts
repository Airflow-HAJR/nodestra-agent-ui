import { useState, useEffect, useRef, useCallback } from 'react'
import type { AgentState, ConnectionState, Message, VoiceAgentConfig, ServerMessage } from '../lib/types'
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

function getAudioFormat(mimeType: string): 'webm' | 'ogg' | 'mp4' {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'mp4'
  return 'webm'
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
  streamingText: string      // text being revealed as audio plays
  isStreaming: boolean       // true while agent audio + text reveal is happening
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  clearMessages: () => void
  unlockAudio: () => void
}

export function useVoiceAgent(config: VoiceAgentConfig): VoiceAgentHook {
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const configRef = useRef(config)

  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<Array<{ base64: string; text: string }>>([])
  const isPlayingRef = useRef(false)
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Pending agent text (arrives before audio)
  const pendingAgentTextRef = useRef<string | null>(null)

  useEffect(() => { configRef.current = config }, [config])

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
      source.onended = () => { playNextAudio() }
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
    if (!isPlayingRef.current) playNextAudio()
  }, [playNextAudio])

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
                // Add user message immediately
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
            case 'audio':
              enqueueAudio(msg.data)
              break
            case 'status':
              // Ignore server-sent idle/speaking while we're locally playing audio —
              // our playback queue controls when we return to idle.
              if (isPlayingRef.current || audioQueueRef.current.length > 0) break
              setAgentState(msg.state)
              break
            case 'error':
              setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: 'agent',
                text: msg.message,
                timestamp: new Date(),
              }])
              setAgentState('idle')
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

  // ─── PTT ────────────────────────────────────────────────────────────
  const stopListening = useCallback(async () => {
    if (agentState !== 'listening') return
    stopListeningRef.current = null
    setAgentState('thinking')
    try {
      const blob = await recorder.stop()
      const base64 = await blobToBase64(blob)
      const format = getAudioFormat(blob.type || 'audio/webm')
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'audio', data: base64, language: configRef.current.language, format }))
      } else {
        setAgentState('idle')
      }
    } catch { setAgentState('idle') }
  }, [agentState, recorder])

  useEffect(() => { stopListeningRef.current = stopListening }, [stopListening])

  const startListening = useCallback(async () => {
    if (agentState !== 'idle' && agentState !== 'error') return
    await recorder.start({ onSilence: () => { stopListeningRef.current?.() } })
    setAgentState('listening')
  }, [agentState, recorder])

  const clearMessages = useCallback(() => setMessages([]), [])

  return {
    agentState, connectionState, messages,
    isConnected: connectionState === 'connected',
    audioLevel: recorder.audioLevel,
    micPermission: recorder.permissionState,
    micError: recorder.error,
    streamingText, isStreaming,
    startListening, stopListening, clearMessages, unlockAudio,
  }
}
