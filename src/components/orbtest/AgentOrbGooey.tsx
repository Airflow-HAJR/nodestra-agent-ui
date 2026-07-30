import type { CSSProperties } from 'react'
import type { AgentState } from '../../lib/types'

interface AgentOrbGooeyProps {
  state: AgentState
  audioLevel?: number
  muted?: boolean
  onInterrupt?: () => void
}

/** Recreation of uiverse.io/Cobp/hot-dodo-99 (resting + hover states only),
 * with the iOS-Safari paint fixes applied: nonzero-size host SVG instead of
 * 0x0, an explicit filter region, and forced GPU layers on the filtered
 * element. This is the same SVG `feGaussianBlur` + `feColorMatrix` "gooey"
 * technique the app originally shipped with. */
export function AgentOrbGooey({ state, audioLevel = 0, muted = false, onInterrupt }: AgentOrbGooeyProps) {
  const isSpeaking = state === 'speaking' && !muted
  const listenScale = state === 'listening' ? 1 + Math.min(audioLevel, 1) * 0.12 : 1

  return (
    <div className="orb-gooey-container">
      <div
        className={`orb-gooey orb-gooey--${muted ? 'muted' : state}${isSpeaking ? ' orb-gooey--intense' : ''}`}
        style={{ '--listen-scale': listenScale } as CSSProperties}
        role="img"
        aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
        onClick={isSpeaking ? onInterrupt : undefined}
      >
        <div className="orb-gooey-icons">
          <svg width="24" height="24" viewBox="0 0 24 24">
            <g fill="none">
              <rect width="8" height="13" x="8" y="2" fill="currentColor" rx="4" />
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 11a7 7 0 1 0 14 0m-7 10v-2" />
            </g>
          </svg>
        </div>
        <div className="orb-gooey-ball">
          <div className="orb-gooey-lines" />
          <div className="orb-gooey-rings" />
        </div>
      </div>

      <svg width="1" height="1" style={{ position: 'absolute', visibility: 'hidden' }} aria-hidden="true">
        <filter id="orb-gooey-filter" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
        </filter>
      </svg>
    </div>
  )
}
