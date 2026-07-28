import { useRef, useState, useCallback } from 'react'
import { getSupportedMimeType } from '../lib/constants'

const SILENCE_THRESHOLD = 0.04   // RMS level below this = silence
const SPEECH_THRESHOLD  = 0.08   // RMS level above this = speech detected
const SILENCE_DELAY_MS  = 1200   // ms of silence before auto-stop
const MIN_SPEECH_MS     = 400    // must detect speech for this long before VAD can trigger

interface AudioRecorderOptions {
  onSilence?: () => void         // called when VAD detects end of speech
  onLevelChange?: (level: number) => void
}

interface AudioRecorderState {
  isRecording: boolean
  audioLevel: number
  permissionState: 'unknown' | 'granted' | 'denied' | 'requesting'
  error: string | null
}

interface AudioRecorder {
  start: (opts?: AudioRecorderOptions) => Promise<void>
  stop: () => Promise<Blob>
  isRecording: boolean
  audioLevel: number
  permissionState: AudioRecorderState['permissionState']
  error: string | null
}

export function useAudioRecorder(): AudioRecorder {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    audioLevel: 0,
    permissionState: 'unknown',
    error: null,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const resolveStopRef = useRef<((blob: Blob) => void) | null>(null)

  // VAD state
  const speechDetectedRef = useRef(false)
  const speechStartTimeRef = useRef(0)
  const silenceStartRef = useRef<number | null>(null)
  const onSilenceRef = useRef<(() => void) | null>(null)
  const onLevelChangeRef = useRef<((level: number) => void) | null>(null)

  const stopLevelMonitor = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
    setState(prev => ({ ...prev, audioLevel: 0 }))
  }, [])

  const startLevelMonitor = useCallback((stream: MediaStream) => {
    try {
      audioContextRef.current = new AudioContext()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 512
      source.connect(analyserRef.current)

      const dataArray = new Float32Array(analyserRef.current.fftSize)

      // Reset VAD state
      speechDetectedRef.current = false
      speechStartTimeRef.current = 0
      silenceStartRef.current = null

      const tick = () => {
        if (!analyserRef.current) return

        analyserRef.current.getFloatTimeDomainData(dataArray)

        // Compute RMS
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i]
        const rms = Math.sqrt(sum / dataArray.length)
        const level = Math.min(1, rms * 6) // scale to 0-1

        setState(prev => ({ ...prev, audioLevel: level }))
        onLevelChangeRef.current?.(level)

        // VAD logic
        const now = Date.now()

        if (rms > SPEECH_THRESHOLD) {
          // Speech detected
          silenceStartRef.current = null
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true
            speechStartTimeRef.current = now
          }
        } else if (rms < SILENCE_THRESHOLD) {
          // Silence detected
          if (speechDetectedRef.current) {
            const speechDuration = now - speechStartTimeRef.current
            if (speechDuration >= MIN_SPEECH_MS) {
              // Enough speech was detected — start silence timer
              if (silenceStartRef.current === null) {
                silenceStartRef.current = now
              } else if (now - silenceStartRef.current >= SILENCE_DELAY_MS) {
                // Silence for long enough — trigger auto-stop
                silenceStartRef.current = null
                onSilenceRef.current?.()
                return // stop ticking
              }
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(tick)
      }

      animFrameRef.current = requestAnimationFrame(tick)
    } catch {
      // Audio level monitoring optional
    }
  }, [])

  const start = useCallback(async (opts?: AudioRecorderOptions) => {
    if (state.isRecording) return

    onSilenceRef.current = opts?.onSilence ?? null
    onLevelChangeRef.current = opts?.onLevelChange ?? null

    setState(prev => ({ ...prev, permissionState: 'requesting', error: null }))

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      })
      setState(prev => ({ ...prev, permissionState: 'granted' }))
    } catch (err) {
      const message = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone access and try again.'
        : 'Could not access microphone. Please check your device settings.'
      setState(prev => ({ ...prev, permissionState: 'denied', error: message, isRecording: false }))
      throw new Error(message)
    }

    streamRef.current = stream
    chunksRef.current = []

    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      resolveStopRef.current?.(blob)
      resolveStopRef.current = null
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      stopLevelMonitor()
      setState(prev => ({ ...prev, isRecording: false, audioLevel: 0 }))
    }

    recorder.start(100)
    startLevelMonitor(stream)
    setState(prev => ({ ...prev, isRecording: true }))
  }, [state.isRecording, startLevelMonitor, stopLevelMonitor])

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('Recorder not active'))
        return
      }
      resolveStopRef.current = resolve
      recorder.stop()
    })
  }, [])

  return {
    start,
    stop,
    isRecording: state.isRecording,
    audioLevel: state.audioLevel,
    permissionState: state.permissionState,
    error: state.error,
  }
}
