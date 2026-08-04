// Google sign-in without losing the conversation.
//
// The obvious way to do OAuth on the web — redirect the whole page to Google
// and back — costs the user everything they were in the middle of: the socket
// closes, the transcript is gone, and they come back to a fresh greeting. For
// an assistant someone is talking to while walking to a gate, that's the wrong
// trade for a feature that's supposed to be optional and frictionless.
//
// So the handshake happens in a small popup instead. The main tab keeps
// talking the entire time. The popup is the same app running in "callback"
// mode: it lets supabase-js exchange the code for a session (which lands in
// localStorage, shared with the opener because it's the same origin), tells
// the opener, and closes itself.
//
// If the popup is blocked, sign-in falls back to a full-page redirect — worse,
// but never broken.

import { supabase } from './supabase'

export const AUTH_POPUP_NAME = 'nodestra-auth'
export const AUTH_DONE_MESSAGE = 'nodestra-auth-complete'

/** True when this document is the sign-in popup rather than the app itself. */
export function isAuthPopup(): boolean {
  try {
    if (window.name !== AUTH_POPUP_NAME || !window.opener) return false
    // Only treat it as the callback if the OAuth response is actually on the
    // URL — a stale window reusing the name shouldn't render a blank page.
    const url = new URL(window.location.href)
    return (
      url.searchParams.has('code') ||
      url.searchParams.has('error') ||
      /(^|[#&])(access_token|error)=/.test(url.hash)
    )
  } catch {
    return false
  }
}

export function openAuthPopup(url: string): Window | null {
  const width = 480
  const height = 640
  // Centered on the window the user is actually looking at, which on a
  // multi-monitor desktop is not the same as centered on screen 0.
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
  return window.open(
    url,
    AUTH_POPUP_NAME,
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},` +
      'toolbar=no,menubar=no,location=no,status=no',
  )
}

/** Run inside the popup: finish the exchange, hand off, close. */
export async function completeAuthPopup(): Promise<void> {
  try {
    // Creating the client kicks off the code exchange; getSession waits for it.
    await supabase?.auth.getSession()
  } catch {
    /* Fall through and close anyway — the opener re-reads the real state. */
  }
  try {
    window.opener?.postMessage({ type: AUTH_DONE_MESSAGE }, window.location.origin)
  } catch {
    /* opener gone (user closed the tab) — nothing to hand off to */
  }
  window.close()
}
