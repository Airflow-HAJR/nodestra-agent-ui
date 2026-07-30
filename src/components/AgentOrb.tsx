import type { CSSProperties } from 'react'
import type { AgentState } from '../lib/types'

interface AgentOrbProps {
  state: AgentState
  audioLevel?: number
  muted?: boolean
  onInterrupt?: () => void
}

export function AgentOrb({ state, audioLevel = 0, muted = false, onInterrupt }: AgentOrbProps) {
  const isSpeaking = state === 'speaking' && !muted
  const listenScale = state === 'listening' ? 1 + Math.min(audioLevel, 1) * 0.12 : 1

  return (
    <div
      className={`orb-container${muted ? ' orb-container--muted' : ''}`}
      role="img"
      aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
      onClick={isSpeaking ? onInterrupt : undefined}
      data-state={muted ? 'idle' : state}
    >
      <div
        className={`orb-core${isSpeaking ? ' orb-core--intense' : ''}`}
        style={{ '--listen-scale': listenScale } as CSSProperties}
      >
        <div className="orb-core__sheen" />
      </div>
    </div>
  )
}
