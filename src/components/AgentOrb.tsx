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
    <div className="orb-container">
      <div
        className={`orb orb--${muted ? 'muted' : state}${isSpeaking ? ' orb--intense' : ''}`}
        style={{ '--listen-scale': listenScale } as CSSProperties}
        role="img"
        aria-label={muted ? 'Agent is muted' : `Agent is ${state}`}
        onClick={isSpeaking ? onInterrupt : undefined}
      >
        <div className="icons">
          <svg className="svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <g fill="none">
              <rect width="8" height="13" x="8" y="2" fill="currentColor" rx="4" />
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 11a7 7 0 1 0 14 0m-7 10v-2" />
            </g>
          </svg>
        </div>
        <div className="ball">
          <div className="container-lines" />
          <div className="container-rings" />
        </div>
      </div>

      {/* Gooey filter used by .ball — kept out of layout flow.
          iOS Safari fails to paint filters defined inside a 0x0 SVG on first
          render, and clips the blur without an explicit filter region — use
          a 1x1 visibility:hidden SVG and widen the region instead. */}
      <svg width="1" height="1" style={{ position: 'absolute', visibility: 'hidden' }} aria-hidden="true">
        <filter id="orb-gooey" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
        </filter>
      </svg>
    </div>
  )
}
