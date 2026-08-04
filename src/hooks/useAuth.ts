import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AUTH_CONFIGURED, authRedirectUrl, supabase } from '../lib/supabase'
import { USER_ID_STORAGE_KEY, generateUserId } from '../lib/constants'
import { AUTH_DONE_MESSAGE, openAuthPopup } from '../lib/authPopup'

export interface AccountProfile {
  id: string
  name: string | null
  firstName: string | null
  email: string | null
  avatarUrl: string | null
}

export interface AuthHook {
  /** False until we know whether a stored session exists — the UI holds off on
   *  rendering "Sign in" for that instant so it can't flash at a signed-in user. */
  ready: boolean
  available: boolean          // accounts configured at all on this deployment
  account: AccountProfile | null
  signingIn: boolean
  error: string | null
  /** Stable id the agent's memory is keyed by: the account when signed in, the
   *  per-device guest id otherwise. Changing it re-identifies the session. */
  userId: string
  accessToken: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  /** A guaranteed-fresh token for REST calls — the cached one may have expired
   *  while the tab sat in the background. Null when signed out. */
  getAccessToken: () => Promise<string | null>
}

function getOrCreateGuestId(): string {
  try {
    const stored = localStorage.getItem(USER_ID_STORAGE_KEY)
    if (stored) return stored
    const id = generateUserId()
    localStorage.setItem(USER_ID_STORAGE_KEY, id)
    return id
  } catch {
    return generateUserId()
  }
}

function profileFrom(session: Session | null): AccountProfile | null {
  const user = session?.user
  if (!user) return null
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta['full_name'] ?? meta['name'] ?? null) as string | null
  return {
    id: user.id,
    name,
    firstName: name ? name.trim().split(' ')[0] || null : null,
    email: user.email ?? ((meta['email'] as string | undefined) ?? null),
    avatarUrl: ((meta['avatar_url'] ?? meta['picture']) as string | undefined) ?? null,
  }
}

/** Drop the OAuth handshake leftovers (?code=…&state=… or #access_token=…) from
 *  the address bar once supabase-js has consumed them. Purely hygiene — a URL
 *  the user might share or bookmark should not carry auth material. */
function scrubAuthParamsFromUrl(): void {
  const url = new URL(window.location.href)
  const hadHash = /(^|[#&])(access_token|refresh_token|provider_token)=/.test(url.hash)
  let changed = hadHash
  for (const key of ['code', 'state', 'error', 'error_description']) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true }
  }
  if (!changed) return
  if (hadHash) url.hash = ''
  window.history.replaceState({}, '', url.toString())
}

export function useAuth(): AuthHook {
  const [ready, setReady] = useState(!AUTH_CONFIGURED)
  const [session, setSession] = useState<Session | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guestIdRef = useRef<string>(getOrCreateGuestId())

  useEffect(() => {
    if (!supabase) return
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setReady(true)
      scrubAuthParamsFromUrl()
    }).catch(() => { if (active) setReady(true) })

    // Fires for the redirect handshake, token refreshes, sign-out, and sign-in
    // in another tab — so this one hook is the only thing that has to know.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      setReady(true)
      setSigningIn(false)
      scrubAuthParamsFromUrl()
    })

    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  // The popup hands the session back through localStorage and then pings us.
  // Without this the main tab would sit on a stale "signed out" until something
  // else happened to re-read the session.
  useEffect(() => {
    if (!supabase) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if ((event.data as { type?: string } | null)?.type !== AUTH_DONE_MESSAGE) return
      supabase!.auth.getSession().then(({ data }) => {
        setSession(data.session)
        setSigningIn(false)
        if (!data.session) setError('sign-in did not complete')
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return
    setError(null)
    setSigningIn(true)
    const { data, error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectUrl(),
        // We drive the navigation ourselves so it can happen in a popup and
        // leave the conversation in this tab untouched.
        skipBrowserRedirect: true,
        // Google's account chooser rather than a silent sign-in: at an airport
        // the last account used on a device is often not this traveler's.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (err || !data?.url) {
      setSigningIn(false)
      setError(err?.message ?? 'could not start sign-in')
      return
    }
    const popup = openAuthPopup(data.url)
    if (!popup) {
      // Popup blocked — fall back to the whole-page redirect. The conversation
      // is lost, but signing in still works, which is the more important half.
      window.location.href = data.url
      return
    }
    // The popup can also be closed by hand. Nothing broke if it was, but the
    // button shouldn't be left spinning forever.
    const poll = setInterval(() => {
      if (!popup.closed) return
      clearInterval(poll)
      setSigningIn(false)
    }, 500)
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    setError(null)
    await supabase.auth.signOut()
    setSession(null)
  }, [])

  const getAccessToken = useCallback(async () => {
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const account = profileFrom(session)

  return {
    ready,
    available: AUTH_CONFIGURED,
    account,
    signingIn,
    error,
    userId: account ? `sub:${account.id}` : guestIdRef.current,
    accessToken: session?.access_token ?? null,
    signInWithGoogle,
    signOut,
    getAccessToken,
  }
}
