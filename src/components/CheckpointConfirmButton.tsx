import type { CheckpointPrompt } from '../lib/types'

interface Props {
  prompt: CheckpointPrompt
  onConfirm: () => void
}

// Floating pill shown while a multi-level trajectory is waiting for the user
// to confirm they reached the current floor's elevator/escalator/stairs —
// the tap-to-confirm backup to just saying so out loud. Tapping it doesn't
// advance the map itself; it sends checkpoint_ack and waits for the agent's
// own judgment call (including its GPS sanity-check) to actually move the
// trajectory forward, exactly like a spoken confirmation would.
export function CheckpointConfirmButton({ prompt, onConfirm }: Props) {
  return (
    <button className="checkpoint-confirm-btn" onClick={onConfirm}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      I&rsquo;m at {prompt.poiName}
    </button>
  )
}
