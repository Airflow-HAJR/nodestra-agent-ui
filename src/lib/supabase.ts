// Supabase client — the whole of our account system.
//
// Accounts are optional and deliberately thin: there is no sign-up form, no
// password, and no profile to fill in. "Continue with Google" is the entire
// flow, and what it buys is that the preferences the agent picks up are still
// there on the next visit. Everything else about the app works identically
// signed out, so this module is allowed to not exist: if the project isn't
// configured, `supabase` is null and the UI hides the account affordance
// rather than showing a button that can't work.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env['VITE_SUPABASE_URL'] as string | undefined
const SUPABASE_ANON_KEY = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined

export const AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase: SupabaseClient | null = AUTH_CONFIGURED
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        // Survive a page reload — a traveler who backgrounds the tab to check
        // a boarding pass should come back still signed in.
        persistSession: true,
        autoRefreshToken: true,
        // The OAuth redirect comes back with the session in the URL fragment;
        // detectSessionInUrl consumes it. We strip the fragment ourselves
        // afterwards (see useAuth) so a shared or bookmarked link never
        // carries a token.
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

/** Where Google should send the browser back to. Respects vite's `base`, so
 *  the app hosted at /oakland/ returns to /oakland/ and not the domain root. */
export function authRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}
