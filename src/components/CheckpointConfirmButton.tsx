import type { CheckpointPrompt } from '../lib/types'

interface Props {
  prompt: CheckpointPrompt
  onConfirm: () => void
  onNeedHelp: () => void
}

// Two floating pills shown whenever there's an active checkpoint on a
// trajectory — "Made it to __" is the tap-to-confirm backup to just saying
// so out loud (same effect either way: the agent's own judgment, including
// its GPS sanity-check, decides whether to actually advance). "Need help"
// doesn't advance anything — it just tells the agent the user is stuck so
// it can give more detail without losing their place.
export function CheckpointConfirmButton({ prompt, onConfirm, onNeedHelp }: Props) {
  return (
    <div className="checkpoint-pill-row">
      <button className="checkpoint-pill checkpoint-pill--confirm" onClick={onConfirm}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Made it to {prompt.poiName}
      </button>
      <button className="checkpoint-pill checkpoint-pill--help" onClick={onNeedHelp}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2.5 3" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        Need help
      </button>
    </div>
  )
}
