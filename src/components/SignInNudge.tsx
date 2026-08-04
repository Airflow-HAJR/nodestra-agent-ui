import { GoogleMark } from './GoogleMark'
import { strings } from '../lib/i18n'

interface Props {
  uiLang: string
  /** Opens the account sheet, which is where signing in actually happens —
   *  the nudge is an invitation, not a second implementation of the flow. */
  onSignIn: () => void
  onDismiss: () => void
}

/**
 * A one-time callout hanging off the account button.
 *
 * The account button is deliberately quiet (a 26px outline in the header), which
 * is right for something optional but means nobody discovers what it buys them.
 * This says it once — sign in and the preferences the agent picks up survive the
 * walk out of the terminal — and then never asks again.
 *
 * Dismissing is as easy as accepting: "Not now" is a real button next to the
 * offer, not an X the user has to hunt for.
 */
export function SignInNudge({ uiLang, onSignIn, onDismiss }: Props) {
  const S = strings(uiLang)
  return (
    <div className="signin-nudge" role="dialog" aria-label={S.nudgeTitle} onClick={e => e.stopPropagation()}>
      <div className="signin-nudge__arrow" aria-hidden="true" />
      <div className="signin-nudge__title">
        <GoogleMark />
        {S.nudgeTitle}
      </div>
      <p className="signin-nudge__body">{S.nudgeBody}</p>
      <div className="signin-nudge__actions">
        <button className="signin-nudge__btn signin-nudge__btn--quiet" onClick={onDismiss}>
          {S.notNow}
        </button>
        <button className="signin-nudge__btn signin-nudge__btn--primary" onClick={onSignIn}>
          {S.signIn}
        </button>
      </div>
    </div>
  )
}
