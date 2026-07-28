import { useCallback } from 'react'
import type { AgentState } from '../lib/types'

interface PushToTalkButtonProps {
  agentState: AgentState
  isConnected: boolean
  micPermission: 'unknown' | 'granted' | 'denied' | 'requesting'
  onPressStart: () => Promise<void>
  onPressEnd: () => Promise<void>
}

export function PushToTalkButton({
  agentState,
  isConnected,
  micPermission,
  onPressStart,
  onPressEnd,
}: PushToTalkButtonProps) {
  const isListening = agentState === 'listening'
  const isThinking  = agentState === 'thinking'
  const isSpeaking  = agentState === 'speaking'
  const isDisabled  = !isConnected || isThinking || isSpeaking || micPermission === 'denied'

  const handleClick = useCallback(async () => {
    if (isListening) {
      // Tap again while listening = cancel / send early
      await onPressEnd()
    } else if (!isDisabled) {
      await onPressStart()
    }
  }, [isListening, isDisabled, onPressStart, onPressEnd])

  const getLabel = () => {
    if (micPermission === 'denied') return 'Mic disabled'
    if (!isConnected) return 'Connecting...'
    if (isThinking)   return 'Processing...'
    if (isSpeaking)   return 'Speaking...'
    if (isListening)  return 'Listening... tap to send'
    return 'Tap to speak'
  }

  const getButtonClass = () => {
    const base = 'ptt-button'
    if (isDisabled)   return `${base} ptt-button--disabled`
    if (isListening)  return `${base} ptt-button--listening`
    return base
  }

  return (
    <div className="ptt-container">
      <span className="ptt-label" aria-live="polite">
        {getLabel()}
      </span>

      <button
        className={getButtonClass()}
        onClick={handleClick}
        disabled={isDisabled && !isListening}
        aria-label={getLabel()}
        aria-pressed={isListening}
      >
        {isListening && (
          <>
            <span className="ptt-pulse-ring ptt-pulse-ring-1" />
            <span className="ptt-pulse-ring ptt-pulse-ring-2" />
          </>
        )}

        {/* Mic icon — stop square when listening */}
        {isListening ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>

      {micPermission === 'denied' && (
        <p className="ptt-mic-denied" role="alert">
          Microphone access is blocked. Enable it in your browser settings.
        </p>
      )}
    </div>
  )
}
