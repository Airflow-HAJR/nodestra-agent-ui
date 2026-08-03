import { useRef, useState, useCallback } from 'react'
import { getSupportedMimeType } from '../lib/constants'

const SILENCE_THRESHOLD = 0.04   // RMS level below this = silence
const SPEECH_THRESHOLD  = 0.08   // RMS level above this = speech detected
const SILENCE_DELAY_MS  = 2300   // ms of silence before auto-stop — generous enough to survive natural mid-sentence pauses
const MIN_SPEECH_MS     = 400    // must detect speech for this long before VAD can trigger
const PRE_ROLL_RECYCLE_MS = 1500 // recycle the idle pre-roll recorder this often so it never accumulates more than this much lead-in

interface AudioRecorderOptions {
  onSilence?: () => void              // called when VAD detects end of speech
  onSpeechStart?: () => void          // called once VAD is confident speech has started
  onLevelChange?: (level: number) => void
  onChunk?: (blob: Blob) => void      // called with each raw MediaRecorder chunk as it's produced
  speechThreshold?: number            // override SPEECH_THRESHOLD for this session
  speechSustainMs?: number            // require RMS to stay above threshold this long before firing onSpeechStart
}

interface AudioRecorderState {
  isRecording: boolean
  audioLevel: number
  permissionState: 'unknown' | 'granted' | 'denied' | 'requesting'
  error: string | null
}

interface AudioRecorder {
  start: (opts?: AudioRecorderOptions) => Promise<void>
  stop: () => Promise<void>
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
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const resolveStopRef = useRef<(() => void) | null>(null)

  // VAD state
  const speechDetectedRef = useRef(false)
  const speechStartTimeRef = useRef(0)
  const speechCandidateStartRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const onSilenceRef = useRef<(() => void) | null>(null)
  const onSpeechStartRef = useRef<(() => void) | null>(null)
  const onLevelChangeRef = useRef<((level: number) => void) | null>(null)
  const onChunkRef = useRef<((blob: Blob) => void) | null>(null)
  const speechThresholdRef = useRef(SPEECH_THRESHOLD)
  const speechSustainMsRef = useRef(0)

  // Pre-roll: while waiting for VAD to confirm speech, every chunk the
  // (currently active) recorder produces is buffered here in full — nothing
  // is ever evicted mid-stream, which is what corrupted the WebM container
  // in an earlier attempt at this. Instead, the recorder itself gets
  // recycled periodically (see preRollIntervalRef) so it's never more than
  // PRE_ROLL_RECYCLE_MS old, keeping the buffer small and always contiguous
  // from its own chunk 0. Once speech is confirmed, whatever the *current*
  // recorder has buffered so far gets flushed as-is — no gaps possible.
  const chunkBufferRef = useRef<Blob[]>([])
  const preRollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // Starts a MediaRecorder on the already-open stream. Its very first chunk
  // carries the container header; every chunk we ever forward for this
  // utterance comes from this same instance, so the stream stays valid for
  // the server-side decoder.
  //
  // Before speech is confirmed, chunks are buffered (not sent) — see
  // ondataavailable below — so the moment VAD fires we can flush the lead-in
  // audio too, instead of losing whatever was said while RMS was still
  // ramping up to SPEECH_THRESHOLD. (An earlier version of this pinned only
  // the very first chunk forever and evicted everything else past a size
  // cap, which left a multi-second gap in the encoded stream whenever the
  // mic sat idle for a while before speech started — that corrupted
  // transcription entirely. This version never evicts; see
  // schedulePreRollRecycle for how the buffer stays bounded instead.)
  const beginUtteranceRecording = useCallback((stream: MediaStream) => {
    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder
    chunkBufferRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return
      if (speechDetectedRef.current) {
        onChunkRef.current?.(e.data) // speech confirmed — forward live
      } else {
        chunkBufferRef.current.push(e.data) // still waiting — buffer, don't send
      }
    }
    recorder.onstop = () => {
      resolveStopRef.current?.()
      resolveStopRef.current = null
    }

    recorder.start(100)
  }, [])

  // While waiting for speech, swap in a fresh recorder every
  // PRE_ROLL_RECYCLE_MS so its buffered lead-in never grows past that —
  // bounding memory/latency without ever having to evict a chunk out from
  // the middle of an in-progress recording.
  const schedulePreRollRecycle = useCallback((stream: MediaStream) => {
    if (preRollIntervalRef.current) clearInterval(preRollIntervalRef.current)
    preRollIntervalRef.current = setInterval(() => {
      if (speechDetectedRef.current) return // speech already confirmed elsewhere — nothing to do
      const old = mediaRecorderRef.current
      if (old && old.state !== 'inactive') {
        old.ondataavailable = null
        old.onstop = null
        try { old.stop() } catch { /* already stopped */ }
      }
      beginUtteranceRecording(stream)
    }, PRE_ROLL_RECYCLE_MS)
  }, [beginUtteranceRecording])

  const stopPreRollRecycle = useCallback(() => {
    if (preRollIntervalRef.current) {
      clearInterval(preRollIntervalRef.current)
      preRollIntervalRef.current = null
    }
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
      speechCandidateStartRef.current = null
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
        const isSilent = rms < SILENCE_THRESHOLD

        if (rms > speechThresholdRef.current) {
          // Above threshold — silence timer doesn't apply
          silenceStartRef.current = null
          if (!speechDetectedRef.current && speechCandidateStartRef.current === null) {
            speechCandidateStartRef.current = now
          }
        } else if (isSilent) {
          // True silence — any above-threshold blip so far didn't hold up
          speechCandidateStartRef.current = null
        }
        // Natural speech dips in and out of the threshold band between
        // syllables — check sustain duration by elapsed time since the first
        // crossing, not by requiring this exact frame to also be loud, so
        // brief quiet moments don't reset progress toward the sustain window.
        if (!speechDetectedRef.current && speechCandidateStartRef.current !== null
            && now - speechCandidateStartRef.current >= speechSustainMsRef.current) {
          speechDetectedRef.current = true
          speechStartTimeRef.current = speechCandidateStartRef.current
          speechCandidateStartRef.current = null
          stopPreRollRecycle()
          // Fire onSpeechStart FIRST — it sends the 'audio_start' message that
          // opens the server's transcription socket. Only then flush the
          // buffered lead-in audio (already-running recorder, never evicted,
          // so this is always a gapless continuation of its own chunk 0),
          // so those chunks never race ahead of the message that makes the
          // server ready to receive them.
          onSpeechStartRef.current?.()
          for (const chunk of chunkBufferRef.current) onChunkRef.current?.(chunk)
          chunkBufferRef.current = []
        }

        if (isSilent) {
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
  }, [stopPreRollRecycle])

  const start = useCallback(async (opts?: AudioRecorderOptions) => {
    if (state.isRecording) return

    onSilenceRef.current = opts?.onSilence ?? null
    onSpeechStartRef.current = opts?.onSpeechStart ?? null
    onLevelChangeRef.current = opts?.onLevelChange ?? null
    onChunkRef.current = opts?.onChunk ?? null
    speechThresholdRef.current = opts?.speechThreshold ?? SPEECH_THRESHOLD
    speechSustainMsRef.current = opts?.speechSustainMs ?? 0

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
    // Start pre-roll recording immediately (not lazily at speech onset) so
    // quiet lead-in audio can be buffered and flushed once VAD confirms
    // speech; schedulePreRollRecycle keeps swapping in a fresh recorder so
    // that buffer never grows past PRE_ROLL_RECYCLE_MS.
    beginUtteranceRecording(stream)
    schedulePreRollRecycle(stream)

    startLevelMonitor(stream)
    setState(prev => ({ ...prev, isRecording: true }))
  }, [state.isRecording, startLevelMonitor, beginUtteranceRecording, schedulePreRollRecycle])

  const stop = useCallback((): Promise<void> => {
    stopPreRollRecycle() // otherwise a pending recycle could fire after teardown and record on a dead stream
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      const finish = () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        stopLevelMonitor()
        setState(prev => ({ ...prev, isRecording: false, audioLevel: 0 }))
      }

      if (recorder && recorder.state !== 'inactive') {
        resolveStopRef.current = () => { finish(); resolve() }
        recorder.stop()
      } else {
        // No utterance was ever recorded this session (mic was open for
        // VAD monitoring only) — still tear down the stream/analyser.
        finish()
        resolve()
      }
    })
  }, [stopLevelMonitor, stopPreRollRecycle])

  return {
    start,
    stop,
    isRecording: state.isRecording,
    audioLevel: state.audioLevel,
    permissionState: state.permissionState,
    error: state.error,
  }
}
