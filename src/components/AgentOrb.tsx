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
  const isSpeaking = state === 'speaking' && !muted
  const size = useOrbSize()

  return (
    <div
      className={`orb-container${muted ? ' orb-container--muted' : ''}`}
      role="img"
      aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
      onClick={isSpeaking ? onInterrupt : undefined}
    >
      {/* interactive={false} — with it true, the theme forces the canvas
          down to a near-zero scale in idle/error and only shows a tiny
          "tap to start" dot instead; false keeps it at full scale, and the
          CSS below forces its opacity so it never fades out on idle/error
          either. Volume already drives the sphere's own size pulse while
          speaking — nothing extra needed for that. */}
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
