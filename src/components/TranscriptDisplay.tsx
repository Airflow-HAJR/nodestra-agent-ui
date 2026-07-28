import { useEffect, useRef } from 'react'
import type { Message } from '../lib/types'

interface Props {
  messages: Message[]
  historyOpen: boolean
  onToggleHistory: () => void
}

export function TranscriptDisplay({ messages, historyOpen, onToggleHistory }: Props) {
  const historyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (historyOpen && historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [historyOpen, messages.length])

  if (messages.length === 0) return null

  const latest = messages[messages.length - 1]
  const penult = messages.length >= 2 ? messages[messages.length - 2] : null

  return (
    <>
      {/* Full history overlay */}
      {historyOpen && (
        <div style={{ position: 'absolute', inset: 0, background: '#fff', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
            <button
              onClick={onToggleHistory}
              style={{ background: 'none', border: 'none', fontSize: 14, color: '#A66B7A', cursor: 'pointer', padding: '4px 8px', marginRight: 8 }}
            >
              ← Back
            </button>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Conversation</span>
          </div>
          <div ref={historyRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map(msg => (
              <div key={msg.id} className={`history-msg${msg.role === 'user' ? ' history-msg--user' : ''}`}>
                <div className={`chat-bubble chat-bubble--${msg.role}`}>{msg.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent messages — default view */}
      {!historyOpen && (
        <div className="chat-recent" onClick={onToggleHistory} style={{ cursor: 'pointer' }}>
          {penult && (
            <div className={`chat-msg chat-msg--${penult.role} chat-msg--faded`}>
              <div className={`chat-bubble chat-bubble--${penult.role}`}>{penult.text}</div>
            </div>
          )}
          <div className={`chat-msg chat-msg--${latest.role}`}>
            <div className={`chat-bubble chat-bubble--${latest.role}`}>{latest.text}</div>
          </div>
          {messages.length > 2 && (
            <div className="chat-expand-hint">tap to see full conversation</div>
          )}
        </div>
      )}
    </>
  )
}
