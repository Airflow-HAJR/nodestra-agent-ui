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
      onClick={isSpeaking ? onInterrupt : undefined}
      role="img"
      aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
    >
      <Orb state={muted ? 'idle' : state} volume={muted ? 0 : audioLevel} theme="cloud" size={size} interactive={false} />
    </div>
  )
}
