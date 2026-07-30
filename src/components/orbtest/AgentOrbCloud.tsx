import { useEffect, useState } from 'react'
import { Orb } from 'orb-ui'
import type { AgentState } from '../../lib/types'

interface AgentOrbCloudProps {
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

/** Recreation of orb-ui.com's default "cloud" theme (npm package `orb-ui`),
 * wired up in controlled mode against our own AgentState. */
export function AgentOrbCloud({ state, audioLevel = 0, muted = false, onInterrupt }: AgentOrbCloudProps) {
  const size = useOrbSize()

  return (
    <div className={`orb-container${muted ? ' orb-container--muted' : ''}`} role="img" aria-label={`Agent is ${state}`}>
      <Orb
        state={muted ? 'idle' : state}
        volume={muted ? 0 : audioLevel}
        theme="cloud"
        size={size}
        interactive
        onStart={() => {}}
        onStop={() => onInterrupt?.()}
      />
    </div>
  )
}
