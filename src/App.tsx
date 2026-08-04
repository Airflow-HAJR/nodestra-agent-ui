import { useState, useCallback, useEffect, useRef } from 'react'
import { AgentOrb } from './components/AgentOrb'
import { LanguageSelector } from './components/LanguageSelector'
import { MapDirectionsPanel } from './components/MapDirectionsPanel'
import { CheckpointConfirmButton } from './components/CheckpointConfirmButton'
import { AccountButton } from './components/AccountButton'
import { AccountSheet } from './components/AccountSheet'
import { useVoiceAgent } from './hooks/useVoiceAgent'
import { useAuth } from './hooks/useAuth'
import { useGeolocation } from './hooks/useGeolocation'
import { useTypewriter } from './hooks/useTypewriter'
import { LANGUAGES, AUTO_LANGUAGE, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, API_BASE_URL, WS_URL, GOOGLE_MAPS_API_KEY, AGENT_AVATAR_URL } from './lib/constants'
import { uiLanguage, strings, RTL_LANGUAGES } from './lib/i18n'
import { haversineMeters } from './lib/geo'
import type { Language } from './lib/types'

const TWILIO_NUMBER = import.meta.env.VITE_TWILIO_NUMBER ?? ''

const MAP_AUTO_CLOSE_MS = 5000
const MAP_COLLAPSE_ANIM_MS = 500

function getStoredLanguage(): string {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? DEFAULT_LANGUAGE } catch { return DEFAULT_LANGUAGE }
}
export function App() {
  const [language, setLanguage]   = useState(getStoredLanguage)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [isSmsOpen, setIsSmsOpen]     = useState(false)
  const [mapSheetOpen, setMapSheetOpen] = useState(false)
  const [mapSheetClosing, setMapSheetClosing] = useState(false)
  const [textOpen, setTextOpen]       = useState(false)
  const [textValue, setTextValue]     = useState('')
  const [smsPhone, setSmsPhone]   = useState('')
  const [smsSent, setSmsSent]     = useState(false)

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
  })

  // Under auto the chrome follows whatever the server last heard, so the whole
  // page moves to the traveler's language without them touching the pill.
  const uiLang = uiLanguage(language, agent.detectedLanguage)
  const S = strings(uiLang)
  const isRtl = RTL_LANGUAGES.has(uiLang)

  // Auto-request location on mount — triggers the browser's native permission popup
  useEffect(() => { geo.requestLocation() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!action || (action.type !== 'show_directions' && action.type !== 'show_route' && action.type !== 'show_trajectory')) return
    if (agent.agentState !== 'speaking') return
    if (lastShownMapActionRef.current === action) return
    lastShownMapActionRef.current = action
    clearMapTimers()
    setMapSheetClosing(false)
    setMapSheetOpen(true)
    mapAutoCloseTimerRef.current = setTimeout(collapseMapSheet, MAP_AUTO_CLOSE_MS)
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
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {auth.available && auth.ready && (
            <AccountButton
              account={auth.account}
              label={auth.account ? `${S.account}: ${auth.account.name ?? auth.account.email ?? ''}` : S.signIn}
              onClick={() => setAccountOpen(true)}
            />
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
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <button type="submit" className="text-input-send" disabled={!textValue.trim()} aria-label={S.send}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
              </svg>
            </button>
          </form>
        ) : (
          <>
            <button
              className="bottom-icon-btn"
              onClick={(e) => { e.stopPropagation(); openTextInput() }}
              aria-label={S.typeInstead}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="6" y1="9" x2="6" y2="9" /><line x1="10" y1="9" x2="10" y2="9" /><line x1="14" y1="9" x2="14" y2="9" /><line x1="18" y1="9" x2="18" y2="9" />
                <line x1="6" y1="13" x2="18" y2="13" />
              </svg>
            </button>

            <button
              className={`mute-btn${agent.muted ? ' mute-btn--muted' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleMuteToggle() }}
              aria-label={agent.muted ? S.unmuteMic : S.muteMic}
            >
              {agent.muted ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>

            <button
              className="bottom-icon-btn bottom-icon-btn--nav"
              onClick={(e) => { e.stopPropagation(); openMapSheet() }}
              aria-label={S.showMap}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="3" />
                <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
              </svg>
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
            <div className="settings-actions">
              <button
                className="settings-action-btn"
                onClick={() => { setOverflowOpen(false); setIsSmsOpen(true); setSmsSent(false) }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
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
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
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
