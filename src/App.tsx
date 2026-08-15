import { useState, useCallback, useEffect, useRef } from 'react'
import { ChevronDown, X, Send, Keyboard, Mic, MicOff, MapPin, MessageSquare, CircleCheckBig } from 'lucide-react'
import { AgentOrb } from './components/AgentOrb'
import { LanguageSelector } from './components/LanguageSelector'
import { MapDirectionsPanel } from './components/MapDirectionsPanel'
import { CheckpointConfirmButton } from './components/CheckpointConfirmButton'
import { AccountButton } from './components/AccountButton'
import { AccountSheet } from './components/AccountSheet'
import { SignInNudge } from './components/SignInNudge'
import { VoiceSettings } from './components/VoiceSettings'
import { useVoiceAgent } from './hooks/useVoiceAgent'
import { useAuth } from './hooks/useAuth'
import { useGeolocation } from './hooks/useGeolocation'
import { useTypewriter } from './hooks/useTypewriter'
import { LANGUAGES, AUTO_LANGUAGE, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, API_BASE_URL, WS_URL, GOOGLE_MAPS_API_KEY, AGENT_AVATAR_URL, SIGNIN_NUDGE_STORAGE_KEY, SIGNIN_NUDGE_DELAY_MS, SIGNIN_NUDGE_REARM_MS, VOICE_SETTINGS_STORAGE_KEY, VOICE_SPEED_DEFAULT, VOICE_SPEED_MIN, VOICE_SPEED_MAX, VOICE_EXPRESSIVENESS_DEFAULT } from './lib/constants'
import { uiLanguage, strings, RTL_LANGUAGES } from './lib/i18n'
import { haversineMeters } from './lib/geo'
import type { Language, VoiceSettings as VoiceSettingsValue } from './lib/types'

const TWILIO_NUMBER = import.meta.env.VITE_TWILIO_NUMBER ?? ''

const MAP_AUTO_CLOSE_MS = 5000
// A route collapses quickly because the agent is about to name the next
// checkpoint anyway. A set of options is the opposite: the user is reading it
// to make a choice, and it takes longer than five seconds to compare three
// places against what the agent is saying about them.
const MAP_OPTIONS_AUTO_CLOSE_MS = 15000
const MAP_COLLAPSE_ANIM_MS = 500

function getStoredLanguage(): string {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? DEFAULT_LANGUAGE } catch { return DEFAULT_LANGUAGE }
}

const DEFAULT_VOICE: VoiceSettingsValue = {
  speed: VOICE_SPEED_DEFAULT,
  expressiveness: VOICE_EXPRESSIVENESS_DEFAULT,
}

/** Voice sliders as last left on this device.
 *
 *  Read defensively rather than trusted: this is the one bit of state the app
 *  restores straight into an outbound message, and a hand-edited or
 *  half-written localStorage entry shouldn't be able to make the agent mute
 *  itself. The server clamps too — this is just the nearer of the two nets. */
function getStoredVoice(): VoiceSettingsValue {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_VOICE
    const parsed = JSON.parse(raw) as Partial<VoiceSettingsValue>
    const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
    return {
      speed: clamp(parsed?.speed, VOICE_SPEED_MIN, VOICE_SPEED_MAX, VOICE_SPEED_DEFAULT),
      expressiveness: clamp(parsed?.expressiveness, 0, 1, VOICE_EXPRESSIVENESS_DEFAULT),
    }
  } catch {
    return DEFAULT_VOICE
  }
}

/** Whether this visit is allowed to make the sign-in offer. */
function signInNudgeArmed(): boolean {
  try {
    const raw = localStorage.getItem(SIGNIN_NUDGE_STORAGE_KEY)
    if (raw === null) return true              // never asked on this device
    const elapsed = Date.now() - Number(raw)
    // NaN from a corrupt or hand-edited value, and a negative gap from a clock
    // that moved backwards, both mean the record can't be trusted — and an
    // untrustworthy record shouldn't be able to silence the offer forever.
    if (!Number.isFinite(elapsed) || elapsed < 0) return true
    return elapsed > SIGNIN_NUDGE_REARM_MS
  } catch {
    // A browser that refuses storage (private mode) can't remember a "not now",
    // so it would ask on every single load. Failing to remember the answer is a
    // reason to ask less, not more.
    return false
  }
}
export function App() {
  const [language, setLanguage]   = useState(getStoredLanguage)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  // Read once per mount. Within a single visit the answer never changes, and a
  // ref (not state) is what keeps a re-render from re-offering something the
  // traveler already waved off.
  const nudgeSpentRef = useRef(!signInNudgeArmed())
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [isSmsOpen, setIsSmsOpen]     = useState(false)
  const [mapSheetOpen, setMapSheetOpen] = useState(false)
  const [mapSheetClosing, setMapSheetClosing] = useState(false)
  const [textOpen, setTextOpen]       = useState(false)
  const [textValue, setTextValue]     = useState('')
  const [smsPhone, setSmsPhone]   = useState('')
  const [smsSent, setSmsSent]     = useState(false)
  const [voice, setVoice]         = useState<VoiceSettingsValue>(getStoredVoice)

  const geo   = useGeolocation()
  // Identity comes from the auth hook whether or not anyone has signed in: it
  // hands back the account when there is one and the per-device guest id when
  // there isn't, so the agent always has something stable to key memory to.
  const auth  = useAuth()
  const agent = useVoiceAgent({
    serverUrl: WS_URL,
    language,
    userId: auth.userId,
    accessToken: auth.accessToken,
    authReady: auth.ready,
    voice,
  })

  // Under auto the chrome follows whatever the server last heard, so the whole
  // page moves to the traveler's language without them touching the pill.
  const uiLang = uiLanguage(language, agent.detectedLanguage)
  const S = strings(uiLang)
  const isRtl = RTL_LANGUAGES.has(uiLang)

  // Auto-request location on mount — triggers the browser's native permission popup
  useEffect(() => { geo.requestLocation() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── The sign-in offer ──
  // The account button is a 26px outline in the header: correct for something
  // optional, but it never tells anyone what it's for, so nobody signs in and
  // every traveler starts from scratch. Once a trip this says it out loud — an
  // account is what makes the agent's memory survive the terminal — and then
  // stamps the time, whichever way it was answered, so it stays quiet for the
  // rest of this visit and comes back on the next one.
  const closeNudge = useCallback(() => {
    nudgeSpentRef.current = true
    setNudgeOpen(false)
    try { localStorage.setItem(SIGNIN_NUDGE_STORAGE_KEY, String(Date.now())) } catch { /* asked anyway */ }
  }, [])

  // Persist first, then push. Persisting is what makes the setting survive the
  // walk to the gate; the send is what makes the current conversation obey it.
  // A failed write must not stop the send — the session should still sound
  // right even on a browser that refuses storage.
  const handleVoiceChange = useCallback((next: VoiceSettingsValue) => {
    setVoice(next)
    try { localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(next)) } catch { /* session-only */ }
    agent.setVoice(next)
  }, [agent])

  useEffect(() => {
    if (!auth.available || !auth.ready) return
    // `ready` above is what keeps this honest: until the stored session has been
    // read, `account` is null for everyone, and pitching an account to someone
    // who already has one is the one mistake this can't make.
    if (auth.account) { closeNudge(); return }
    if (nudgeSpentRef.current) return
    const timer = setTimeout(() => setNudgeOpen(true), SIGNIN_NUDGE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [auth.available, auth.ready, auth.account, closeNudge])

  const hasUnlockedRef   = useRef(false)
  const historyScrollRef = useRef<HTMLDivElement>(null)
  const wasMutedBeforeTypingRef = useRef(false)
  const [newestAgentMsgId, setNewestAgentMsgId]   = useState<string | null>(null)
  const prevLastAgentIdRef = useRef<string | null>(null)

  // A bare destination pin isn't worth interrupting the user for — only
  // trajectories (routes/directions) pop the map open automatically.
  const mapAutoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapCollapseTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearMapTimers = useCallback(() => {
    if (mapAutoCloseTimerRef.current) { clearTimeout(mapAutoCloseTimerRef.current); mapAutoCloseTimerRef.current = null }
    if (mapCollapseTimerRef.current) { clearTimeout(mapCollapseTimerRef.current); mapCollapseTimerRef.current = null }
  }, [])

  // Animates the sheet shrinking down into the nav button, then hides it —
  // the map action itself is left untouched, so the nav button keeps
  // whatever trajectory was last shown.
  const collapseMapSheet = useCallback(() => {
    clearMapTimers()
    setMapSheetClosing(true)
    mapCollapseTimerRef.current = setTimeout(() => {
      setMapSheetOpen(false)
      setMapSheetClosing(false)
      mapCollapseTimerRef.current = null
    }, MAP_COLLAPSE_ANIM_MS)
  }, [clearMapTimers])

  // The map_action websocket message arrives the instant the backend tool
  // runs — i.e. while the agent is still 'thinking', well before it starts
  // talking. We don't want the map popping open mid-reasoning, so we hold
  // onto the latest trajectory action and only reveal it once the agent
  // actually starts speaking (agentState === 'speaking'). lastShownMapActionRef
  // dedupes so the same action doesn't re-trigger the open animation every
  // time this effect re-runs for an unrelated agentState change.
  const lastShownMapActionRef = useRef<typeof agent.mapAction>(null)
  useEffect(() => {
    const action = agent.mapAction
    if (!action || (action.type !== 'show_directions' && action.type !== 'show_route' && action.type !== 'show_trajectory' && action.type !== 'show_options')) return
    if (agent.agentState !== 'speaking') return
    if (lastShownMapActionRef.current === action) return
    lastShownMapActionRef.current = action
    clearMapTimers()
    setMapSheetClosing(false)
    setMapSheetOpen(true)
    mapAutoCloseTimerRef.current = setTimeout(
      collapseMapSheet,
      action.type === 'show_options' ? MAP_OPTIONS_AUTO_CLOSE_MS : MAP_AUTO_CLOSE_MS,
    )
  }, [agent.mapAction, agent.agentState, clearMapTimers, collapseMapSheet])

  // Same idea as the map reveal above, but held back even longer: the
  // checkpoint pills fade in only once the agent has actually finished
  // speaking about the checkpoint (agentState settles back to idle/
  // listening/error), not the instant the prompt arrives or even once
  // speech starts — so they show up right as (or just after) the agent
  // says something like "...or tap the button." revealedCheckpointKeyRef
  // dedupes so a checkpoint that's already visible doesn't reset/re-fade
  // just because agentState fluctuates afterward (e.g. user starts talking).
  const [checkpointVisible, setCheckpointVisible] = useState(false)
  const revealedCheckpointKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const prompt = agent.checkpointPrompt
    if (!prompt) {
      setCheckpointVisible(false)
      revealedCheckpointKeyRef.current = null
      return
    }
    const key = `${prompt.routeId}:${prompt.segmentIndex}:${prompt.stopIndex}`
    if (revealedCheckpointKeyRef.current === key) return
    if (agent.agentState === 'thinking' || agent.agentState === 'speaking') {
      setCheckpointVisible(false)
      return
    }
    revealedCheckpointKeyRef.current = key
    setCheckpointVisible(true)
  }, [agent.checkpointPrompt, agent.agentState])

  useEffect(() => clearMapTimers, [clearMapTimers])

  // Stream live GPS to the backend, throttled — at most once every 4s, or
  // sooner if the fix moved more than ~5m, so the agent's checkpoint-advance
  // logic (advance_map_trajectory) has something reasonably fresh to check
  // against without flooding the socket on every watchPosition tick.
  const lastSentLocationRef = useRef<{ lat: number; lng: number; t: number } | null>(null)
  useEffect(() => {
    if (geo.latitude === null || geo.longitude === null) return
    const now = Date.now()
    const last = lastSentLocationRef.current
    const movedMeters = last
      ? haversineMeters(last.lat, last.lng, geo.latitude, geo.longitude)
      : Infinity
    if (last && now - last.t < 4000 && movedMeters < 5) return
    lastSentLocationRef.current = { lat: geo.latitude, lng: geo.longitude, t: now }
    agent.sendLocation(geo.latitude, geo.longitude, geo.accuracy ?? 9999)
  }, [geo.latitude, geo.longitude, geo.accuracy, agent])

  // Auto-scroll history
  useEffect(() => {
    if (historyOpen && historyScrollRef.current) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight
    }
  }, [historyOpen, agent.messages.length])

  // Track newest agent message for slide-in animation
  useEffect(() => {
    const lastAgent = [...agent.messages].reverse().find(m => m.role === 'agent')
    if (lastAgent && lastAgent.id !== prevLastAgentIdRef.current) {
      prevLastAgentIdRef.current = lastAgent.id
      setNewestAgentMsgId(lastAgent.id)
      setTimeout(() => setNewestAgentMsgId(null), 700)
    }
  }, [agent.messages])

  const ensureAudioUnlocked = () => {
    if (!hasUnlockedRef.current) { hasUnlockedRef.current = true; agent.unlockAudio() }
    if (historyOpen) setHistoryOpen(false)
  }

  // Under auto the pill names what's actually being spoken once we know it,
  // rather than leaving the user staring at "Auto" with no idea what it chose.
  const activeLanguageName = language === AUTO_LANGUAGE
    ? (agent.detectedLanguage
        ? `${S.autoDetect} · ${LANGUAGES.find(l => l.code === agent.detectedLanguage)?.nativeName ?? agent.detectedLanguage}`
        : S.autoDetect)
    : LANGUAGES.find(l => l.code === language)?.nativeName ?? language

  const handleLanguageSelect = useCallback((lang: Language) => {
    setLanguage(lang.code)
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, lang.code) } catch { /* ignore */ }
    // Stops any reply mid-sentence, restarts it in the new language, and
    // retranslates the transcript already on screen.
    agent.changeLanguage(lang.code)
    // The header pill is the confirmation now, so there's nothing left to do
    // in the sheet once a language is picked.
    setOverflowOpen(false)
  }, [agent])

  const handleSmsSubmit = useCallback(async () => {
    if (!smsPhone.trim()) return
    const cleaned = smsPhone.replace(/\D/g, '')
    const e164 = cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`
    try {
      await fetch(`${API_BASE_URL}/sms-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: e164 }),
      })
    } catch { /* non-fatal — still show success */ }
    setSmsSent(true)
  }, [smsPhone])

  const openTextInput = useCallback(() => {
    ensureAudioUnlocked()
    wasMutedBeforeTypingRef.current = agent.muted
    if (!agent.muted) agent.toggleMute()
    setTextOpen(true)
  }, [agent]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeTextInput = useCallback(() => {
    setTextOpen(false)
    setTextValue('')
    if (!wasMutedBeforeTypingRef.current && agent.muted) agent.toggleMute()
  }, [agent])

  const handleTextSubmit = useCallback(() => {
    const trimmed = textValue.trim()
    if (!trimmed) return
    agent.sendText(trimmed)
    closeTextInput()
  }, [textValue, agent, closeTextInput])

  const handleMuteToggle = useCallback(() => {
    ensureAudioUnlocked()
    agent.toggleMute()
  }, [agent]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dismissing the sheet (X / backdrop) only hides it — same as the
  // auto-collapse — so the nav button keeps holding the last trajectory.
  // The docked route is only actually cleared when the agent itself sends
  // a "clear" map action (e.g. arriving at the destination).
  const closeMapSheet = useCallback(() => {
    clearMapTimers()
    setMapSheetClosing(false)
    setMapSheetOpen(false)
  }, [clearMapTimers])

  const openMapSheet = useCallback(() => {
    clearMapTimers()
    setMapSheetClosing(false)
    setMapSheetOpen(true)
  }, [clearMapTimers])

  const isListening = agent.agentState === 'listening'
  const isSpeaking  = agent.agentState === 'speaking'
  const isThinking  = agent.agentState === 'thinking'

  const dotClass = `header-dot header-dot--${
    agent.connectionState === 'connected' ? 'connected'
    : agent.connectionState === 'reconnecting' ? 'reconnecting'
    : 'disconnected'
  }`

  const statusCaption = agent.muted ? S.muted
    : isListening ? S.listening
    // thinkingLabel is the server's per-tool label ("Charting course…") and is
    // still English-only — fall back to the localized generic when absent.
    : isThinking ? (agent.thinkingLabel ?? S.thinking)
    : agent.connectionState === 'reconnecting' ? S.reconnecting
    : agent.connectionState === 'disconnected' ? S.disconnected
    : ''

  const msgs      = agent.messages
  const latest    = msgs[msgs.length - 1]
  const penult    = msgs.length >= 2 ? msgs[msgs.length - 2] : null

  // The user's own words under the orb. This is the same string the hook puts
  // into the conversation — it's replaced in place by the server's final
  // transcript when the utterance closes, and cleared when the reply arrives,
  // so the caption is never a stale interim guess that disagrees with history.
  // (It used to be frozen at whatever the typewriter had revealed the instant
  // listening ended, which lopped the last few words off every turn.)
  const typedPartialTranscript = useTypewriter(agent.partialTranscript, 22)

  // The caption box has a fixed top edge (pinned under the orb) and a fixed
  // floor (above the pills / nav bar), so text past that floor is clipped.
  // Watch for that and let the CSS fade out the overflowing lines rather than
  // cutting them off flat, which read as "that's all the agent said".
  const captionRef = useRef<HTMLDivElement>(null)
  const [captionOverflows, setCaptionOverflows] = useState(false)
  const measureCaption = useCallback(() => {
    const el = captionRef.current
    // Identical state is a no-op in React, so this is safe to call freely.
    setCaptionOverflows(!!el && el.scrollHeight - el.clientHeight > 1)
  }, [])
  // No dep array: the caption's inner element is swapped out entirely when the
  // agent moves between speaking / partial / status, so there's no stable node
  // to observe — re-measuring per render (streaming re-renders anyway) is both
  // simpler and always correct.
  useEffect(measureCaption)
  useEffect(() => {
    window.addEventListener('resize', measureCaption)
    return () => window.removeEventListener('resize', measureCaption)
  }, [measureCaption])

  // Google Maps embed URL — passive "my location" view (only rendered inside the map sheet)
  const mapsUrl = geo.latitude !== null
    ? GOOGLE_MAPS_API_KEY
      ? `https://www.google.com/maps/embed/v1/view?key=${GOOGLE_MAPS_API_KEY}&center=${geo.latitude},${geo.longitude}&zoom=18`
      : `https://maps.google.com/maps?ll=${geo.latitude},${geo.longitude}&z=18&output=embed`
    : null

  return (
    <div
      className={`app${agent.checkpointPrompt ? ' app--checkpoint' : ''}`}
      lang={uiLang}
      dir={isRtl ? 'rtl' : 'ltr'}
      onClick={ensureAudioUnlocked}
    >

      {/* ── Header ── */}
      <header className="app-header">
        <span className="header-title">{S.appTitle}</span>
        <div className="header-right">
          <span className={dotClass} />
          {/* Names the language that's actually active, and is the way to
              change it — the old "..." menu hid both facts behind an icon. */}
          <button
            className="header-lang-pill"
            onClick={(e) => { e.stopPropagation(); setOverflowOpen(true) }}
            aria-label={`${S.language}: ${activeLanguageName}. ${S.changeLanguage}`}
          >
            {activeLanguageName}
            <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />
          </button>
          {auth.available && auth.ready && (
            /* Positioned container so the callout can hang off the button it's
               pointing at, rather than being placed against the viewport. */
            <div className="header-account">
              <AccountButton
                account={auth.account}
                label={auth.account ? `${S.account}: ${auth.account.name ?? auth.account.email ?? ''}` : S.signIn}
                onClick={() => { closeNudge(); setAccountOpen(true) }}
              />
              {nudgeOpen && !accountOpen && !overflowOpen && !isSmsOpen && !historyOpen && (
                <SignInNudge
                  uiLang={uiLang}
                  onSignIn={() => { closeNudge(); setAccountOpen(true) }}
                  onDismiss={closeNudge}
                />
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Conversation history (kept, minimized) ──
          Rendered even when empty (as an invisible spacer) so the center
          stage below never changes height — that's what keeps the orb at a
          fixed screen position from the very first message onward. */}
      {msgs.length === 0 ? (
        <div className="chat-area chat-area--empty" aria-hidden="true" />
      ) : (
        <div
          className="chat-area"
          style={{ cursor: msgs.length > 1 ? 'pointer' : 'default' }}
          onClick={(e) => { e.stopPropagation(); if (msgs.length > 1) setHistoryOpen(true) }}
          onWheel={() => { if (msgs.length > 1 && !historyOpen) setHistoryOpen(true) }}
          onTouchMove={() => { if (msgs.length > 1 && !historyOpen) setHistoryOpen(true) }}
        >
          {historyOpen ? (
            <div className="history-overlay" onClick={(e) => e.stopPropagation()}>
              <div className="history-overlay-header">
                <span className="history-overlay-title">{S.conversation}</span>
                <button className="history-overlay-close" onClick={() => setHistoryOpen(false)}>
                  <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" />
                  {S.back}
                </button>
              </div>
              <div className="history-scroll" ref={historyScrollRef}>
                {msgs.map(msg => (
                  <div key={msg.id} className={`msg-row${msg.role === 'user' ? ' msg-row--user' : ''}${msg.id === newestAgentMsgId ? ' msg-row--new' : ''}`}>
                    {msg.role === 'agent' && <img src={AGENT_AVATAR_URL} alt="" className="msg-avatar" />}
                    <div className={`msg-bubble msg-bubble--${msg.role}`}>{msg.text}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-inner">
              {penult && (
                <div className={`msg-row msg-row--faded${penult.role === 'user' ? ' msg-row--user' : ''}`}>
                  {penult.role === 'agent' && <img src={AGENT_AVATAR_URL} alt="" className="msg-avatar" />}
                  <div className={`msg-bubble msg-bubble--${penult.role}`}>{penult.text}</div>
                </div>
              )}
              {latest && (
                <div className={`msg-row${latest.role === 'user' ? ' msg-row--user' : ''}${latest.id === newestAgentMsgId ? ' msg-row--new' : ''}`}>
                  {latest.role === 'agent' && <img src={AGENT_AVATAR_URL} alt="" className="msg-avatar" />}
                  <div className={`msg-bubble msg-bubble--${latest.role}`}>{latest.text}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Center stage: the orb ── */}
      <div className="center-stage">
        <AgentOrb
          state={agent.agentState}
          audioLevel={isSpeaking ? agent.agentOutputLevel : agent.audioLevel}
          muted={agent.muted}
          onInterrupt={agent.interrupt}
        />
        <div className={`orb-status${captionOverflows ? ' orb-status--more' : ''}`}>
          <div className="orb-status-scroll" ref={captionRef}>
            {isSpeaking ? (
              <div className="speaking-caption">
                {agent.streamingText}
                {agent.isStreaming && <span className="speaking-cursor" />}
              </div>
            ) : isThinking ? (
              // What the agent is doing wins over what the user said. Once the
              // turn is handed off, "Charting course…" is the useful thing on
              // screen — the words that were heard have already been confirmed
              // during listening and are a scroll away in the history.
              <div className="status-caption">{statusCaption}</div>
            ) : typedPartialTranscript ? (
              <div className="partial-caption">
                {typedPartialTranscript}
                {isListening && <span className="speaking-cursor" />}
              </div>
            ) : statusCaption ? (
              <div className="status-caption">{statusCaption}</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Checkpoint confirmation pills (main section, above bottom bar) ── */}
      {agent.checkpointPrompt && (
        <CheckpointConfirmButton
          prompt={agent.checkpointPrompt}
          uiLang={uiLang}
          visible={checkpointVisible}
          onConfirm={agent.confirmCheckpoint}
          onNeedHelp={agent.requestCheckpointHelp}
        />
      )}

      {/* ── Bottom bar: keyboard toggle + mute ── */}
      <div className="bottom-bar">
        {textOpen ? (
          <form
            className="text-input-row"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); handleTextSubmit() }}
          >
            <input
              className="text-input"
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder={S.typeMessage}
              onKeyDown={(e) => { if (e.key === 'Escape') closeTextInput() }}
            />
            <button type="button" className="text-input-close" onClick={closeTextInput} aria-label={S.closeInput}>
              <X size={16} strokeWidth={2.5} aria-hidden="true" />
            </button>
            <button type="submit" className="text-input-send" disabled={!textValue.trim()} aria-label={S.send}>
              <Send size={17} strokeWidth={2} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <>
            <button
              className="bottom-icon-btn"
              onClick={(e) => { e.stopPropagation(); openTextInput() }}
              aria-label={S.typeInstead}
            >
              <Keyboard size={19} strokeWidth={1.8} aria-hidden="true" />
            </button>

            <button
              className={`mute-btn${agent.muted ? ' mute-btn--muted' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleMuteToggle() }}
              aria-label={agent.muted ? S.unmuteMic : S.muteMic}
            >
              {agent.muted ? (
                <MicOff size={24} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <Mic size={24} strokeWidth={1.8} aria-hidden="true" />
              )}
            </button>

            <button
              className="bottom-icon-btn bottom-icon-btn--nav"
              onClick={(e) => { e.stopPropagation(); openMapSheet() }}
              aria-label={S.showMap}
            >
              <MapPin size={19} strokeWidth={1.8} aria-hidden="true" />
              {agent.mapAction && (agent.mapAction.type === 'show_directions' || agent.mapAction.type === 'show_route' || agent.mapAction.type === 'show_trajectory') && (
                <span className="nav-map-pulse" aria-hidden="true">
                  <span className="nav-map-pulse__ring" />
                  <span className="nav-map-pulse__ring" />
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* ── Map bottom sheet ── */}
      {mapSheetOpen && (
        <div className={`map-sheet-overlay${mapSheetClosing ? ' map-sheet-overlay--collapsing' : ''}`} onClick={(e) => { e.stopPropagation(); closeMapSheet() }}>
          <div className={`map-sheet${mapSheetClosing ? ' map-sheet--collapsing' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            {agent.mapAction ? (
              <MapDirectionsPanel
                action={agent.mapAction}
                uiLang={uiLang}
                userLat={geo.latitude ?? undefined}
                userLng={geo.longitude ?? undefined}
                onDismiss={closeMapSheet}
              />
            ) : mapsUrl ? (
              <div className="maps-frame-wrap">
                <iframe
                  src={mapsUrl}
                  title={S.yourLocation}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  style={{ pointerEvents: 'none' }}
                />
                <div className="maps-blue-dot" aria-hidden="true">
                  <div className="maps-blue-dot__ring" />
                  <div className="maps-blue-dot__core" />
                </div>
              </div>
            ) : (
              <div className="map-sheet-empty">{S.locationUnavailable}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Account sheet ── */}
      {accountOpen && (
        <AccountSheet
          auth={auth}
          uiLang={uiLang}
          memoryPersisted={agent.memoryPersisted}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {/* ── Overflow / settings sheet ── */}
      {overflowOpen && (
        <div className="sheet-overlay" onClick={() => setOverflowOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{S.language}</div>
            <div className="lang-grid">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  className={`lang-pill${language === lang.code ? ' lang-pill--active' : ''}`}
                  onClick={() => handleLanguageSelect(lang)}
                >
                  {lang.code === AUTO_LANGUAGE ? S.autoDetect : lang.nativeName}
                </button>
              ))}
            </div>
            <VoiceSettings value={voice} uiLang={uiLang} onChange={handleVoiceChange} />

            <div className="settings-actions">
              <button
                className="settings-action-btn"
                onClick={() => { setOverflowOpen(false); setIsSmsOpen(true); setSmsSent(false) }}
              >
                <MessageSquare size={15} strokeWidth={2} aria-hidden="true" />
                {S.textMeInstead}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SMS sheet ── */}
      {isSmsOpen && (
        <div className="sheet-overlay" onClick={() => setIsSmsOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{S.smsTitle}</div>
            {smsSent ? (
              <div className="sms-success">
                <CircleCheckBig size={40} strokeWidth={2} color="#22c55e" aria-hidden="true" />
                <p>{S.smsSuccess}</p>
                {TWILIO_NUMBER && (
                  <p className="sms-number">{S.smsOr} <strong>{TWILIO_NUMBER}</strong></p>
                )}
              </div>
            ) : (
              <>
                <p className="sms-desc">{S.smsDesc}</p>
                <input
                  className="sms-input"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={smsPhone}
                  onChange={e => setSmsPhone(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSmsSubmit()}
                  autoFocus
                />
                {TWILIO_NUMBER && (
                  <p className="sms-or">{S.smsOr} <strong>{TWILIO_NUMBER}</strong></p>
                )}
                <button
                  className="sms-submit"
                  onClick={handleSmsSubmit}
                  disabled={!smsPhone.trim()}
                >
                  {S.smsSubmit}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hidden — kept for geo hook */}
      <LanguageSelector isOpen={false} currentLanguage={language} onSelect={handleLanguageSelect} onClose={() => {}} />
    </div>
  )
}
