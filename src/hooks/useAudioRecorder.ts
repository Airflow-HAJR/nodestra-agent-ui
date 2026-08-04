import { useRef, useState, useCallback, useEffect } from 'react'
import { getSupportedMimeType } from '../lib/constants'

// ── VAD tuning ───────────────────────────────────────────────────────────────
// Thresholds are derived from the room rather than fixed. A fixed RMS cutoff
// has to be either too high for a soft speaker in a quiet gate area or too low
// for a concourse next to a boarding announcement, and it was the first: the
// mic was open, the level meter moved, and speech simply never crossed the
// line. The floor below tracks the ambient level continuously and speech is
// whatever sits clearly above it.
const FLOOR_MIN          = 0.006  // quietest ambient level we'll believe
const SPEECH_MARGIN      = 3.0    // speech = this much louder than the room
const SPEECH_FLOOR_MIN   = 0.030  // ...but never demand less than this
const SPEECH_FLOOR_MAX   = 0.120  // ...nor more, however loud the room gets
const SILENCE_MARGIN     = 1.6    // back down to near the room = silence again
const SILENCE_DELAY_MS   = 2300   // silence before auto-stop — survives natural mid-sentence pauses
const MIN_SPEECH_MS      = 400    // must have been speaking this long before silence can end the turn
const SUSTAIN_NORMAL_MS  = 80     // brief, so a normal turn still feels instant
const SUSTAIN_BARGEIN_MS = 220    // longer while the agent talks — see 'bargein' below
const BARGEIN_MARGIN     = 2.2    // ...and louder, too
// Barge-in keeps its own absolute band. The adaptive floor is measured
// between utterances and doesn't know the speaker is about to be playing the
// agent's voice into the mic, so on a phone with no headphones a
// room-relative threshold alone would let the agent interrupt itself.
const BARGEIN_FLOOR_MIN  = 0.090
const BARGEIN_FLOOR_MAX  = 0.200
const PRE_ROLL_RECYCLE_MS = 1500  // recycle the idle pre-roll recorder this often so it never accumulates more than this much lead-in
const STALL_MS           = 4000   // dead-silent *digital* signal for this long = the capture died, not a quiet user
const TRACK_CHECK_MS     = 1000   // how often to look at the track's own health flags

// 'bargein' is the mic being held open underneath the agent's own voice. On a
// phone with no headphones the mic hears the speaker, so cutting in has to
// require something clearly louder and more sustained than a normal turn does.
export type VadMode = 'normal' | 'bargein'

interface AudioRecorderOptions {
  onSilence?: () => void              // called when VAD detects end of speech
  onSpeechStart?: () => void          // called once VAD is confident speech has started
  onLevelChange?: (level: number) => void
  onChunk?: (blob: Blob) => void      // called with each raw MediaRecorder chunk as it's produced
  onStalled?: () => void              // the mic went dead while still nominally open — caller should restart it
  mode?: VadMode
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
  /** Retune the VAD on an already-open mic — no teardown, no permission churn. */
  setMode: (mode: VadMode) => void
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
  // Authoritative "is the mic open" flag. state.isRecording is a render behind
  // and callers poll it to decide whether to open the mic — reading the stale
  // value is how you end up with two live getUserMedia streams, or with none.
  const isRecordingRef = useRef(false)
  const startInFlightRef = useRef(false)
  // Bumped once per successful mic open, so a teardown callback that lands
  // after a restart can tell it no longer owns anything (see stop()).
  const sessionRef = useRef(0)

  // VAD state
  const speechDetectedRef = useRef(false)
  const speechStartTimeRef = useRef(0)
  const speechCandidateStartRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const silenceFiredRef = useRef(false)
  const noiseFloorRef = useRef(SPEECH_FLOOR_MIN / SPEECH_MARGIN)
  const onSilenceRef = useRef<(() => void) | null>(null)
  const onSpeechStartRef = useRef<(() => void) | null>(null)
  const onLevelChangeRef = useRef<((level: number) => void) | null>(null)
  const onChunkRef = useRef<((blob: Blob) => void) | null>(null)
  const onStalledRef = useRef<(() => void) | null>(null)
  const modeRef = useRef<VadMode>('normal')

  // Stall detection
  const deadSignalSinceRef = useRef<number | null>(null)
  const lastTrackCheckRef = useRef(0)
  const stallReportedRef = useRef(false)

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
  // ramping up to the speech threshold. (An earlier version of this pinned
  // only the very first chunk forever and evicted everything else past a size
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
      if (!isRecordingRef.current) return   // torn down under us
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

  const reportStall = useCallback(() => {
    if (stallReportedRef.current) return
    stallReportedRef.current = true
    onStalledRef.current?.()
  }, [])

  const startLevelMonitor = useCallback(async (stream: MediaStream) => {
    try {
      const ctx = new AudioContext()
      audioContextRef.current = ctx
      // A context created outside a user gesture starts suspended on iOS and
      // in Chrome's autoplay policy, and a suspended analyser reports pure
      // zeroes forever. That is the mic that "just doesn't pick anything up"
      // until you toggle mute — the toggle happened to be a real tap.
      if (ctx.state === 'suspended') { try { await ctx.resume() } catch { /* stall watchdog covers it */ } }
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Float32Array(analyser.fftSize)

      // Reset VAD state
      speechDetectedRef.current = false
      speechStartTimeRef.current = 0
      speechCandidateStartRef.current = null
      silenceStartRef.current = null
      silenceFiredRef.current = false
      noiseFloorRef.current = SPEECH_FLOOR_MIN / SPEECH_MARGIN
      deadSignalSinceRef.current = null
      // Seeded to now, not 0: a track that reports muted at the very first
      // frame would otherwise trip the watchdog instantly, and a restart that
      // trips it again immediately is a hot loop, not a recovery.
      lastTrackCheckRef.current = Date.now()
      stallReportedRef.current = false

      const tick = () => {
        // Every path below re-arms the frame at the end. An earlier version
        // returned out of the loop when silence fired, which killed VAD for
        // good if the caller then declined to stop the recorder (typing a
        // message does exactly that) — mic open, level meter live, nothing
        // ever detected again.
        const a = analyserRef.current
        if (!a) { animFrameRef.current = null; return }

        a.getFloatTimeDomainData(dataArray)

        let sum = 0
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i]
        const rms = Math.sqrt(sum / dataArray.length)
        const level = Math.min(1, rms * 6) // scale to 0-1 for the orb

        setState(prev => (prev.audioLevel === level ? prev : { ...prev, audioLevel: level }))
        onLevelChangeRef.current?.(level)

        const now = Date.now()

        // ── Stall watchdog ──
        // A real mic always has a noise floor; a mathematically silent signal
        // means the capture graph died (context suspended by the OS, track
        // muted by another app, device switched away) even though every
        // object involved still claims to be live.
        if (rms < 1e-7) {
          if (deadSignalSinceRef.current === null) deadSignalSinceRef.current = now
          else if (now - deadSignalSinceRef.current > STALL_MS) reportStall()
        } else {
          deadSignalSinceRef.current = null
        }
        if (now - lastTrackCheckRef.current > TRACK_CHECK_MS) {
          lastTrackCheckRef.current = now
          const track = streamRef.current?.getAudioTracks()[0]
          if (!track || track.readyState === 'ended' || track.muted) reportStall()
          const ctxNow = audioContextRef.current
          if (ctxNow && ctxNow.state === 'suspended') ctxNow.resume().catch(() => {})
        }

        // ── Adaptive thresholds ──
        const bargein = modeRef.current === 'bargein'
        const margin = bargein ? SPEECH_MARGIN * BARGEIN_MARGIN : SPEECH_MARGIN
        const speechThreshold = Math.min(
          bargein ? BARGEIN_FLOOR_MAX : SPEECH_FLOOR_MAX,
          Math.max(bargein ? BARGEIN_FLOOR_MIN : SPEECH_FLOOR_MIN, noiseFloorRef.current * margin)
        )
        const silenceThreshold = Math.min(
          speechThreshold * 0.7,
          Math.max(FLOOR_MIN * 1.5, noiseFloorRef.current * SILENCE_MARGIN)
        )
        const sustainMs = bargein ? SUSTAIN_BARGEIN_MS : SUSTAIN_NORMAL_MS

        // Track the room only between utterances, and only from audio quiet
        // enough to *be* the room. Falls fast and rises slowly, so walking
        // into a noisy hall raises the bar gradually while stepping somewhere
        // quiet makes the mic sensitive again almost immediately.
        if (!speechDetectedRef.current && rms < speechThreshold) {
          const k = rms < noiseFloorRef.current ? 0.25 : 0.02
          noiseFloorRef.current = Math.max(FLOOR_MIN, noiseFloorRef.current + (rms - noiseFloorRef.current) * k)
        }

        const isSilent = rms < silenceThreshold

        if (rms > speechThreshold) {
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
            && now - speechCandidateStartRef.current >= sustainMs) {
          speechDetectedRef.current = true
          speechStartTimeRef.current = speechCandidateStartRef.current
          speechCandidateStartRef.current = null
          silenceFiredRef.current = false
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

        if (isSilent && speechDetectedRef.current && !silenceFiredRef.current) {
          const speechDuration = now - speechStartTimeRef.current
          if (speechDuration >= MIN_SPEECH_MS) {
            if (silenceStartRef.current === null) {
              silenceStartRef.current = now
            } else if (now - silenceStartRef.current >= SILENCE_DELAY_MS) {
              silenceStartRef.current = null
              // Latch rather than stop ticking: the utterance is over as far
              // as VAD is concerned, but the mic may well stay open, and if
              // it does it has to keep working.
              silenceFiredRef.current = true
              speechDetectedRef.current = false
              speechCandidateStartRef.current = null
              // Back to buffering lead-in for a possible next utterance. If the
              // caller does close the mic this is torn down a moment later;
              // if it doesn't, this is what stops the pre-roll buffer growing
              // without bound while nobody is talking.
              const liveStream = streamRef.current
              if (liveStream) schedulePreRollRecycle(liveStream)
              onSilenceRef.current?.()
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(tick)
      }

      animFrameRef.current = requestAnimationFrame(tick)
    } catch {
      // No analyser means no VAD at all — surface it so the caller can rebuild
      // the mic rather than sitting in front of a permanently deaf one.
      reportStall()
    }
  }, [stopPreRollRecycle, schedulePreRollRecycle, reportStall])

  // Calling start() on an already-open mic is not an error and not a no-op: it
  // refreshes the callbacks and retunes the VAD in place. That's what makes an
  // always-on mic switchable between normal and barge-in listening without a
  // teardown — the old code early-returned here instead, so whichever mode the
  // mic happened to open in was the mode it kept. Opening under the agent's
  // voice (barge-in: loud, sustained) and never coming back down is exactly
  // the "it stops hearing me until I toggle mute" failure.
  const start = useCallback(async (opts?: AudioRecorderOptions) => {
    if (opts) {
      onSilenceRef.current = opts.onSilence ?? null
      onSpeechStartRef.current = opts.onSpeechStart ?? null
      onLevelChangeRef.current = opts.onLevelChange ?? null
      onChunkRef.current = opts.onChunk ?? null
      onStalledRef.current = opts.onStalled ?? null
      modeRef.current = opts.mode ?? 'normal'
    }
    if (isRecordingRef.current || startInFlightRef.current) return
    startInFlightRef.current = true

    setState(prev => ({ ...prev, permissionState: 'requesting', error: null }))

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      })
      setState(prev => ({ ...prev, permissionState: 'granted' }))
    } catch (err) {
      startInFlightRef.current = false
      const message = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone access and try again.'
        : 'Could not access microphone. Please check your device settings.'
      setState(prev => ({ ...prev, permissionState: 'denied', error: message, isRecording: false }))
      throw new Error(message)
    }

    streamRef.current = stream
    isRecordingRef.current = true
    sessionRef.current += 1

    // The track can die without the stream noticing (device unplugged, an OS
    // call taking the mic, a tab backgrounded long enough). Both of these are
    // reported as a stall so the caller can rebuild rather than silently
    // holding a mic that stopped producing audio a minute ago.
    const track = stream.getAudioTracks()[0]
    if (track) {
      track.onended = () => reportStall()
      track.onmute = () => reportStall()
    }

    // Start pre-roll recording immediately (not lazily at speech onset) so
    // quiet lead-in audio can be buffered and flushed once VAD confirms
    // speech; schedulePreRollRecycle keeps swapping in a fresh recorder so
    // that buffer never grows past PRE_ROLL_RECYCLE_MS.
    beginUtteranceRecording(stream)
    schedulePreRollRecycle(stream)

    await startLevelMonitor(stream)
    setState(prev => ({ ...prev, isRecording: true }))
    startInFlightRef.current = false
  }, [startLevelMonitor, beginUtteranceRecording, schedulePreRollRecycle, reportStall])

  const stop = useCallback((): Promise<void> => {
    stopPreRollRecycle() // otherwise a pending recycle could fire after teardown and record on a dead stream
    const session = sessionRef.current
    isRecordingRef.current = false
    speechDetectedRef.current = false
    speechCandidateStartRef.current = null
    silenceStartRef.current = null
    return new Promise((resolve) => {
      // Captured now, not read from the refs inside finish(): the MediaRecorder
      // 'stop' event lands a tick or two later, and a restart in between would
      // otherwise have its brand-new stream torn down by this teardown.
      const recorder = mediaRecorderRef.current
      const stream = streamRef.current
      const finish = () => {
        if (stream) {
          for (const t of stream.getTracks()) { t.onended = null; t.onmute = null; t.stop() }
        }
        if (streamRef.current === stream) streamRef.current = null
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null
        // A restart that beat this callback owns the analyser and the audio
        // context now — leave them alone, or the fresh mic loses its VAD the
        // instant it comes up.
        if (sessionRef.current !== session) { resolve(); return }
        chunkBufferRef.current = []
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

  const setMode = useCallback((mode: VadMode) => { modeRef.current = mode }, [])

  // Unmounting mid-recording would otherwise leave the mic light on.
  useEffect(() => () => {
    stopPreRollRecycle()
    isRecordingRef.current = false
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    audioContextRef.current?.close().catch(() => {})
  }, [stopPreRollRecycle])

  return {
    start,
    stop,
    setMode,
    isRecording: state.isRecording,
    audioLevel: state.audioLevel,
    permissionState: state.permissionState,
    error: state.error,
  }
}
