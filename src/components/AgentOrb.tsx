import type { AgentState } from '../lib/types'

interface AgentOrbProps {
  state: AgentState
  audioLevel?: number
}

export function AgentOrb({ state, audioLevel = 0 }: AgentOrbProps) {
  const scale = state === 'listening' ? 1 + audioLevel * 0.15 : 1

  return (
    <div className="orb-container" aria-label={`Agent is ${state}`} role="img">
      {/* Outer ambient glow */}
      <div className={`orb-ambient orb-ambient--${state}`} />

      {/* Ring layers */}
      <div className={`orb-ring orb-ring-outer orb-ring--${state}`} />
      <div className={`orb-ring orb-ring-mid orb-ring--${state}`} />
      <div className={`orb-ring orb-ring-inner orb-ring--${state}`} />

      {/* Core sphere */}
      <div
        className={`orb-core orb-core--${state}`}
        style={{ transform: `scale(${scale})` }}
      >
        {/* Shimmer highlight */}
        <div className="orb-shimmer" />
        {/* Inner glow */}
        <div className={`orb-inner-glow orb-inner-glow--${state}`} />

        {/* State icon */}
        <div className="orb-icon">
          {state === 'idle' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
          {state === 'listening' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="orb-icon-pulse">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="rgba(166,107,122,0.3)" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
          {state === 'thinking' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="orb-icon-spin">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
          )}
          {state === 'speaking' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="rgba(166,107,122,0.3)" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
          {state === 'error' && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
