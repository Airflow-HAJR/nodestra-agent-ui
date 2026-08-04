import { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleMark } from './GoogleMark'
import { API_BASE_URL } from '../lib/constants'
import { strings } from '../lib/i18n'
import type { AuthHook } from '../hooks/useAuth'

interface Props {
  auth: AuthHook
  uiLang: string
  /** The server's verdict on our token — null before it has weighed in. What
   *  the browser thinks isn't good enough to promise someone their preferences
   *  are being kept. */
  memoryPersisted: boolean | null
  onClose: () => void
}

interface RememberedFact {
  id: string
  content: string
  category: string | null
}

/**
 * The one screen where the account exists at all.
 *
 * Signed out it makes a single offer — Continue with Google — and is explicit
 * that everything works without it. Signed in it does the thing an assistant
 * with a memory owes its user: shows exactly what it has remembered, and lets
 * any of it be taken back.
 */
export function AccountSheet({ auth, uiLang, memoryPersisted, onClose }: Props) {
  const S = strings(uiLang)
  const { account, signingIn, signInWithGoogle, signOut, getAccessToken } = auth

  const [facts, setFacts] = useState<RememberedFact[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getAccessToken()
    if (!token) throw new Error('signed out')
    return fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    })
  }, [getAccessToken])

  // Load what's remembered whenever the sheet is open with an account behind
  // it — including right after signing in, when `account` appears.
  useEffect(() => {
    if (!account) { setFacts(null); return }
    let cancelled = false
    setLoading(true)
    authedFetch('/account/me')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(data => { if (!cancelled) setFacts(data.memories ?? []) })
      .catch(() => { if (!cancelled) setFacts([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [account?.id, authedFetch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current) }, [])

  // Removed from the list first, then from the server. If the request fails the
  // row comes back — but the common case is instant, which is what a "forget
  // that" gesture should feel like.
  const forget = useCallback(async (fact: RememberedFact) => {
    setFacts(prev => (prev ?? []).filter(f => f.id !== fact.id))
    try {
      const res = await authedFetch(`/account/memories/${fact.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setFacts(prev => [...(prev ?? []), fact])
    }
  }, [authedFetch])

  const forgetAll = useCallback(async () => {
    if (!confirmingClear) {
      // Two taps, because this one isn't undoable. The armed state disarms
      // itself so a stray first tap doesn't stay dangerous.
      setConfirmingClear(true)
      confirmTimerRef.current = setTimeout(() => setConfirmingClear(false), 4000)
      return
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    setConfirmingClear(false)
    const previous = facts ?? []
    setFacts([])
    try {
      const res = await authedFetch('/account/memories', { method: 'DELETE' })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setFacts(previous)
    }
  }, [confirmingClear, facts, authedFetch])

  const handleSignOut = useCallback(async () => {
    await signOut()
    onClose()
  }, [signOut, onClose])

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">{S.account}</div>

        {account ? (
          <>
            <div className="account-identity">
              {account.avatarUrl
                ? <img className="account-avatar" src={account.avatarUrl} alt="" referrerPolicy="no-referrer" />
                : <div className="account-avatar account-avatar--initial">{(account.name ?? account.email ?? '?').charAt(0).toUpperCase()}</div>}
              <div className="account-identity-text">
                <span className="account-name">{account.name ?? S.account}</span>
                {account.email && <span className="account-email">{account.email}</span>}
              </div>
            </div>

            <p className="account-note">
              {memoryPersisted === false ? S.notSyncing : S.accountSavedNote}
            </p>

            <div className="account-section-title">{S.whatIRemember}</div>
            {loading && facts === null ? (
              <p className="account-empty">{S.loadingAccount}</p>
            ) : facts && facts.length > 0 ? (
              <ul className="memory-list">
                {facts.map(fact => (
                  <li key={fact.id} className="memory-item">
                    <span className="memory-item__text">{fact.content}</span>
                    <button
                      className="memory-item__forget"
                      onClick={() => forget(fact)}
                      aria-label={`${S.forget}: ${fact.content}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="account-empty">{S.nothingRemembered}</p>
            )}

            <div className="settings-actions">
              {facts && facts.length > 0 && (
                <button
                  className={`settings-action-btn${confirmingClear ? ' settings-action-btn--danger' : ''}`}
                  onClick={forgetAll}
                >
                  {confirmingClear ? S.forgetAllConfirm : S.forgetAll}
                </button>
              )}
              <button className="settings-action-btn" onClick={handleSignOut}>{S.signOut}</button>
            </div>
          </>
        ) : (
          <>
            <p className="account-note account-note--pitch">{S.accountWhy}</p>
            <button className="google-signin-btn" onClick={signInWithGoogle} disabled={signingIn}>
              <GoogleMark />
              {signingIn ? S.loadingAccount : S.continueWithGoogle}
            </button>
            {auth.error && <p className="account-error">{S.signInFailed}</p>}
          </>
        )}
      </div>
    </div>
  )
}
