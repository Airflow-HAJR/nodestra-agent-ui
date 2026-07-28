import type { AgentState, ConnectionState } from '../lib/types'

interface StatusBarProps {
  agentState: AgentState
  connectionState: ConnectionState
}

export function StatusBar({ agentState, connectionState }: StatusBarProps) {
  const getConnectionInfo = (): { label: string; color: string } => {
    switch (connectionState) {
      case 'connected':
        return { label: 'Connected', color: 'status-dot--green' }
      case 'connecting':
        return { label: 'Connecting...', color: 'status-dot--yellow' }
      case 'reconnecting':
        return { label: 'Reconnecting...', color: 'status-dot--yellow' }
      case 'disconnected':
        return { label: 'Disconnected', color: 'status-dot--red' }
    }
  }

  const getAgentStatusText = (): string | null => {
    switch (agentState) {
      case 'listening':
        return 'Listening...'
      case 'thinking':
        return 'Thinking...'
      case 'speaking':
        return 'Speaking...'
      case 'error':
        return 'Error — try again'
      default:
        return null
    }
  }

  const conn = getConnectionInfo()
  const agentText = getAgentStatusText()

  return (
    <div className="status-bar" role="status" aria-live="polite">
      <div className="status-connection">
        <span className={`status-dot ${conn.color}`} aria-hidden="true" />
        <span className="status-connection-label">{conn.label}</span>
      </div>

      {agentText && (
        <div className="status-agent">
          <span className="status-agent-text">{agentText}</span>
          {(agentState === 'listening' || agentState === 'thinking' || agentState === 'speaking') && (
            <span className="status-agent-spinner" aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  )
}
