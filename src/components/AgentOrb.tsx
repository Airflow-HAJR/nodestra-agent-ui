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
  const compute = () => Math.min(window.innerWidth * 0.58, 213)
  const [size, setSize] = useState(compute)

  useEffect(() => {
    const onResize = () => setSize(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return size
}

export function AgentOrb({ state, audioLevel = 0, muted = false, onInterrupt }: AgentOrbProps) {
  const size = useOrbSize()

  return (
    <div
      className={`orb-container${muted ? ' orb-container--muted' : ''}`}
      role="img"
      aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
    >
      {/* "circle" is plain CSS/DOM (no WebGL canvas, no hidden-until-active
          gating) so it always paints, including in idle state on iOS
          Safari — the "cloud" theme depends on a WebGL shader that stays
          invisible in idle state and can silently fail on mobile. */}
      <Orb
        state={muted ? 'idle' : state}
        volume={muted ? 0 : audioLevel}
        theme="circle"
        size={size}
        interactive
        onStart={() => {}}
        onStop={() => onInterrupt?.()}
      />
    </div>
  )
}
