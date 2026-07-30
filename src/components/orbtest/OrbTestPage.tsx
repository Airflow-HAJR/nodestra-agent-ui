import { useState } from 'react'
import type { AgentState } from '../../lib/types'
import { AgentOrb } from '../AgentOrb'
import { AgentOrbCloud } from './AgentOrbCloud'
import { AgentOrbGooey } from './AgentOrbGooey'
import './orbtest.css'

const STATES: AgentState[] = ['idle', 'listening', 'thinking', 'speaking', 'error']

export function OrbTestPage() {
  const [state, setState] = useState<AgentState>('idle')
  const [muted, setMuted] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0.4)

  return (
    <div style={{ minHeight: '100dvh', padding: '20px 16px 60px', display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', background: '#fff' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700 }}>Orb comparison</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {STATES.map(s => (
          <button
            key={s}
            onClick={() => setState(s)}
            style={{
              padding: '8px 14px',
              borderRadius: 100,
              border: '1.5px solid #ddd',
              background: state === s ? '#A66B7A' : '#fff',
              color: state === s ? '#fff' : '#333',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setMuted(m => !m)}
          style={{
            padding: '8px 14px',
            borderRadius: 100,
            border: '1.5px solid #ddd',
            background: muted ? '#888' : '#fff',
            color: muted ? '#fff' : '#333',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {muted ? 'muted' : 'unmuted'}
        </button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#666' }}>
        audioLevel
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={audioLevel}
          onChange={e => setAudioLevel(Number(e.target.value))}
        />
        {audioLevel.toFixed(2)}
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, justifyContent: 'center', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#666' }}>Current (custom CSS)</div>
          <AgentOrb state={state} audioLevel={audioLevel} muted={muted} onInterrupt={() => {}} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#666' }}>orb-ui.com (cloud theme)</div>
          <AgentOrbCloud state={state} audioLevel={audioLevel} muted={muted} onInterrupt={() => {}} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#666' }}>uiverse.io/Cobp/hot-dodo-99</div>
          <AgentOrbGooey state={state} audioLevel={audioLevel} muted={muted} onInterrupt={() => {}} />
        </div>
      </div>

      <p style={{ fontSize: 12, color: '#999', maxWidth: 420, textAlign: 'center' }}>
        Dev-only comparison page — open with <code>?orbtest</code> on the URL. Not linked from the app.
      </p>
    </div>
  )
}
