import type { Language } from './types'

export const LANGUAGES: Language[] = [
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

export const WS_URL = import.meta.env['VITE_WS_URL'] as string | undefined
  ?? 'ws://localhost:8000/web/stream'

export const GOOGLE_MAPS_API_KEY = import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] as string | undefined
  ?? ''

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
