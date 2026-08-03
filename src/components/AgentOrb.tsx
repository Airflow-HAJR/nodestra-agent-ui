import { useEffect, useState } from 'react'
import { Orb } from 'orb-ui'
import type { AgentState } from '../lib/types'

interface AgentOrbProps {
  state: AgentState
  audioLevel?: number
  muted?: boolean
  onInterrupt?: () => void
}

function useOrbSize() {
  // Keep in sync with --orb-size in index.css: 25% up from the old
  // min(58vw, 213px), with a viewport-height cap so the caption underneath
  // still has room for 4+ lines on a short screen.
  const compute = () =>
    Math.min(window.innerWidth * 0.725, 266, window.innerHeight * 0.32)
  const [size, setSize] = useState(compute)

  useEffect(() => {
    const onResize = () => setSize(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return size
}

export function AgentOrb({ state, audioLevel = 0, muted = false, onInterrupt }: AgentOrbProps) {
  const isSpeaking = state === 'speaking' && !muted
  const size = useOrbSize()

  // The library's own `volume`-driven pulse tops out around +21% scale on
  // the inner canvas, which reads as barely-there. Layer an extra scale on
  // our own container on top of that so the orb visibly swells with the
  // agent's voice instead of just faintly shimmering. Only set this inline
  // style while speaking — otherwise it would win (inline beats stylesheet)
  // over the CSS `[data-state='listening']` shrink below.
  const speakingScale = isSpeaking ? 1 + Math.min(audioLevel, 1) * 0.3 : undefined

  return (
    <div
      className={`orb-container${muted ? ' orb-container--muted' : ''}`}
      role="img"
      aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
      onClick={isSpeaking ? onInterrupt : undefined}
      data-state={state}
      style={speakingScale !== undefined ? { transform: `scale(${speakingScale})` } : undefined}
    >
      {/* interactive={false} — with it true, the theme forces the canvas
          down to a near-zero scale in idle/error and only shows a tiny
          "tap to start" dot instead; false keeps it at full scale, and the
          CSS below forces its opacity so it never fades out on idle/error
          either. `volume` drives the sphere's own size pulse — while
          speaking that's real playback amplitude from useVoiceAgent's
          output analyser, not the mic (see App.tsx). */}
      <Orb
        state={muted ? 'idle' : state}
        volume={muted ? 0 : audioLevel}
        theme="cloud"
        size={size}
        interactive={false}
      />
    </div>
  )
}
