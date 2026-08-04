import type { CheckpointPrompt } from '../lib/types'
import { strings } from '../lib/i18n'

interface Props {
  prompt: CheckpointPrompt
  visible: boolean
  uiLang: string
  onConfirm: () => void
  onNeedHelp: () => void
}

// Two floating pills shown whenever there's an active checkpoint on a
// trajectory — "Made it to __" is the tap-to-confirm backup to just saying
// so out loud (same effect either way: the agent's own judgment, including
// its GPS sanity-check, decides whether to actually advance). "Need help"
// doesn't advance anything — it just tells the agent the user is stuck so
// it can give more detail without losing their place.
//
// `visible` gates a slow opacity fade rather than the row's mount/unmount —
// the row mounts as soon as the checkpoint arrives (so its layout space is
// reserved) but stays invisible until the caller flips `visible` once the
// agent has actually finished speaking about it.
export function CheckpointConfirmButton({ prompt, visible, uiLang, onConfirm, onNeedHelp }: Props) {
  const S = strings(uiLang)
  return (
    <div className={`checkpoint-pill-row${visible ? ' checkpoint-pill-row--visible' : ''}`}>
      <button
        className="checkpoint-pill checkpoint-pill--confirm"
        onClick={onConfirm}
        title={`${S.madeItTo} ${prompt.poiName}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="checkpoint-pill__prefix">{S.madeItTo}</span>
        <span className="checkpoint-pill__poi">{prompt.poiName}</span>
      </button>
      <button className="checkpoint-pill checkpoint-pill--help" onClick={onNeedHelp}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2.5 3" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        {S.needHelp}
      </button>
    </div>
  )
}
