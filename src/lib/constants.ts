import type { Language } from './types'

export const AUTO_LANGUAGE = 'auto'

export const LANGUAGES: Language[] = [
  // Deepgram transcribes in multilingual mode under this one and reports what
  // it heard, so the UI can follow the speaker instead of asking first.
  { code: AUTO_LANGUAGE, name: 'Auto-detect', nativeName: 'Auto' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'zh', name: 'Mandarin', nativeName: '中文' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
]

export const DEFAULT_LANGUAGE = 'en'
export const LANGUAGE_STORAGE_KEY = 'nodestra_language'
export const USER_ID_STORAGE_KEY = 'nodestra_user_id'
// When the sign-in callout was last answered, either way (epoch millis). A
// timestamp rather than a flag because the offer is per-trip, not per-device:
// see SIGNIN_NUDGE_REARM_MS.
export const SIGNIN_NUDGE_STORAGE_KEY = 'nodestra_signin_nudge_last'

/** How long the app waits before offering the account. Long enough that the
 *  greeting has been said and the traveler has looked at the orb rather than a
 *  popup — the first thing this app does should never be to ask for something. */
export const SIGNIN_NUDGE_DELAY_MS = 6000

/** How long a "not now" holds before the offer comes back.
 *
 *  This app is used in bursts: someone picks it up on their way through a
 *  terminal and puts it down at the gate, then not again until their next trip.
 *  Asking once per device would mean most travelers only ever see the offer on
 *  a trip where they happened to be in a hurry; asking every load would be
 *  nagging. Twelve hours splits those cleanly — longer than any walk through an
 *  airport, so it cannot fire twice in one visit, and shorter than the gap
 *  between an outbound and a return leg, so each trip gets its own ask. */
export const SIGNIN_NUDGE_REARM_MS = 12 * 60 * 60 * 1000

export const WS_URL = import.meta.env['VITE_WS_URL'] as string | undefined
  ?? 'ws://localhost:8000/web/stream'

// The same server as the websocket, over http — the REST endpoints (/sms-invite,
// /account/*) live alongside /web/stream, so there's only ever one URL to
// configure.
export const API_BASE_URL = WS_URL
  .replace(/^ws:/, 'http:')
  .replace(/^wss:/, 'https:')
  .replace(/\/web\/stream$/, '')

export const GOOGLE_MAPS_API_KEY = import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] as string | undefined
  ?? ''

// Public/ assets referenced by URL — must respect vite.config.ts's `base`
// (e.g. '/oakland/') rather than assuming they're served from the domain root.
export const AGENT_AVATAR_URL = `${import.meta.env.BASE_URL}agent-avatar.png`
export const LISTENING_START_SOUND_URL = `${import.meta.env.BASE_URL}sounds/listening-start.wav`
export const LISTENING_STOP_SOUND_URL = `${import.meta.env.BASE_URL}sounds/listening-stop.wav`

export const RECONNECT_BASE_DELAY_MS = 1000
export const RECONNECT_MAX_DELAY_MS = 30000
export const RECONNECT_MAX_ATTEMPTS = 10

export const AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
]

export function getSupportedMimeType(): string {
  for (const mime of AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return 'audio/webm'
}

export function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}
