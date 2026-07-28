import { useState, useCallback, useEffect, useRef } from 'react'
import { LanguageSelector } from './components/LanguageSelector'
import { useVoiceAgent } from './hooks/useVoiceAgent'
import { useGeolocation } from './hooks/useGeolocation'
import { LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, USER_ID_STORAGE_KEY, WS_URL, generateUserId } from './lib/constants'
import type { Language } from './lib/types'

const TWILIO_NUMBER = import.meta.env.VITE_TWILIO_NUMBER ?? ''

const SAMPLE_QUESTIONS = [
  '"Where is gate B12?"',
  '"How do I get to baggage claim?"',
  '"What\'s the status of flight AA 302?"',
  '"Where\'s the nearest restroom?"',
  '"Is there a Starbucks nearby?"',
  '"How do I get to the Escape Lounge?"',
  '"Where can I find an ATM?"',
  '"Is TSA PreCheck open right now?"',
  '"Where can I grab a quick bite?"',
  '"Where do I go for international arrivals?"',
  '"How long is the security line?"',
  '"Where\'s the nearest charging station?"',
  '"Can I bring my water bottle through security?"',
  '"Which terminal is Southwest Airlines?"',
  '"Is my gate in Terminal 1 or 2?"',
  '"Where\'s the car rental pickup?"',
]

function randomQuestion() {
  return SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)]
}


function getStoredLanguage(): string {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? DEFAULT_LANGUAGE } catch { return DEFAULT_LANGUAGE }
}
function getOrCreateUserId(): string {
  try {
    const s = localStorage.getItem(USER_ID_STORAGE_KEY)
    if (s) return s
    const id = generateUserId()
    localStorage.setItem(USER_ID_STORAGE_KEY, id)
    return id
  } catch { return generateUserId() }
}

export function App() {
  const [language, setLanguage]   = useState(getStoredLanguage)
  const [userId]                  = useState(getOrCreateUserId)
  const [isLangOpen, setIsLangOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isSmsOpen, setIsSmsOpen]     = useState(false)
  const [mapExpanded, setMapExpanded] = useState(false)
  const mapCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sampleQ, setSampleQ]         = useState(randomQuestion)
  const [smsPhone, setSmsPhone]   = useState('')
  const [smsSent, setSmsSent]     = useState(false)

  const geo   = useGeolocation()
  const agent = useVoiceAgent({ serverUrl: WS_URL, language, userId })

  const prevStateRef     = useRef('')
  const hasUnlockedRef   = useRef(false)
  const historyScrollRef = useRef<HTMLDivElement>(null)
  const autoCloseTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track state changes (no auto-listen — user taps mic manually)
  useEffect(() => {
    prevStateRef.current = agent.agentState
  }, [agent.agentState])

  // Refresh sample question each time the greeting plays (first agent message)
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const count = agent.messages.length
    const prev  = prevMsgCountRef.current
    prevMsgCountRef.current = count
    // First agent message = greeting; re-roll the sample question
    if (count === 1 && prev === 0 && agent.messages[0]?.role === 'agent') {
      setSampleQ(randomQuestion())
    }
  }, [agent.messages])


  // Auto-scroll history
  useEffect(() => {
    if (historyOpen && historyScrollRef.current) {
      historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight
    }
  }, [historyOpen, agent.messages.length])

  // 5-second auto-close for history
  const scheduleHistoryClose = useCallback(() => {
    if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
    autoCloseTimer.current = setTimeout(() => setHistoryOpen(false), 5000)
  }, [])

  useEffect(() => {
    if (historyOpen) {
      scheduleHistoryClose()
    } else {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
    }
    return () => { if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current) }
  }, [historyOpen, scheduleHistoryClose])

  const ensureAudioUnlocked = () => {
    if (!hasUnlockedRef.current) { hasUnlockedRef.current = true; agent.unlockAudio() }
  }

  const handleMicClick = useCallback(async () => {
    ensureAudioUnlocked()
    if (agent.agentState === 'listening') {
      await agent.stopListening()
    } else if (agent.agentState === 'idle' || agent.agentState === 'error') {
      await agent.startListening()
    }
  }, [agent]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLanguageSelect = useCallback((lang: Language) => {
    setLanguage(lang.code)
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, lang.code) } catch { /* ignore */ }
    setIsLangOpen(false)
  }, [])

  const handleSmsSubmit = useCallback(async () => {
    if (!smsPhone.trim()) return
    const cleaned = smsPhone.replace(/\D/g, '')
    const e164 = cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`
    try {
      await fetch(`${WS_URL.replace('ws://', 'http://').replace('wss://', 'https://').replace('/web/stream', '')}/sms-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: e164 }),
      })
    } catch { /* non-fatal — still show success */ }
    setSmsSent(true)
  }, [smsPhone])

  const currentLang = LANGUAGES.find(l => l.code === language)
  const isListening = agent.agentState === 'listening'
  const isSpeaking  = agent.agentState === 'speaking'
  const isThinking  = agent.agentState === 'thinking'
  const isDisabled  = !agent.isConnected || isThinking || agent.micPermission === 'denied'

  const dotClass = `header-dot header-dot--${
    agent.connectionState === 'connected' ? 'connected'
    : agent.connectionState === 'reconnecting' ? 'reconnecting'
    : 'disconnected'
  }`

  const msgs      = agent.messages
  const latest    = msgs[msgs.length - 1]
  const penult    = msgs.length >= 2 ? msgs[msgs.length - 2] : null
  const prePenult = msgs.length >= 3 ? msgs[msgs.length - 3] : null

  // Google Maps embed URL
  const mapsUrl = geo.latitude !== null
    ? `https://www.google.com/maps?q=${geo.latitude},${geo.longitude}&z=17&output=embed`
    : null

  return (
    <div className="app" onClick={ensureAudioUnlocked}>

      {/* ── Header ── */}
      <header className="app-header">
        <span className="header-title">Oakland International Airport</span>
        <span className={dotClass} />
      </header>

      {/* ── Chat area ── */}
      <div
        className="chat-area"
        style={{ cursor: msgs.length > 2 ? 'pointer' : 'default' }}
        onClick={(e) => { e.stopPropagation(); if (msgs.length > 2) setHistoryOpen(true) }}
      >
        {/* Full history overlay */}
        {historyOpen && (
          <div
            className="history-overlay"
            onTouchStart={scheduleHistoryClose}
            onTouchMove={scheduleHistoryClose}
            onScroll={scheduleHistoryClose}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="history-scroll" ref={historyScrollRef}>
              {msgs.map(msg => (
                <div key={msg.id} className={`msg-row${msg.role === 'user' ? ' msg-row--user' : ''}`}>
                  {msg.role === 'agent' && <img src="/agent-avatar.png" alt="" className="msg-avatar" />}
                  <div className={`msg-bubble msg-bubble--${msg.role}`}>{msg.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Masked recent view */}
        {!historyOpen && (
          <div className="chat-inner">
            {prePenult && (
              <div className={`msg-row msg-row--faded${prePenult.role === 'user' ? ' msg-row--user' : ''}`}>
                {prePenult.role === 'agent' && <img src="/agent-avatar.png" alt="" className="msg-avatar" />}
                <div className={`msg-bubble msg-bubble--${prePenult.role}`}>{prePenult.text}</div>
              </div>
            )}
            {penult && (
              <div className={`msg-row msg-row--faded${penult.role === 'user' ? ' msg-row--user' : ''}`}>
                {penult.role === 'agent' && <img src="/agent-avatar.png" alt="" className="msg-avatar" />}
                <div className={`msg-bubble msg-bubble--${penult.role}`}>{penult.text}</div>
              </div>
            )}
            {latest && (
              <div className={`msg-row${latest.role === 'user' ? ' msg-row--user' : ''}`}>
                {latest.role === 'agent' && <img src="/agent-avatar.png" alt="" className="msg-avatar" />}
                <div className={`msg-bubble msg-bubble--${latest.role}`}>{latest.text}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Center stage ── */}
      <div className="center-stage">
        {isSpeaking ? (
          <div className="speaking-row">
            <img src="/agent-avatar.png" alt="Agent" className="speaking-avatar" />
            <div className="speaking-text">
              {agent.streamingText}
              {agent.isStreaming && <span className="speaking-cursor" />}
            </div>
          </div>
        ) : isThinking ? (
          <div className="thinking-wrap">
            <div className="thinking-spinner" />
            <span className="thinking-label">Thinking…</span>
          </div>
        ) : (
          <button
            className={`mic-btn${isListening ? ' mic-btn--listening' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleMicClick() }}
            disabled={isDisabled && !isListening}
            aria-label={isListening ? 'Send' : 'Tap to speak'}
          >
            {isListening && (
              <>
                <span className="mic-ring" />
                <span className="mic-ring" />
                <span className="mic-ring" />
              </>
            )}
            {isListening ? (
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* ── Sample question prompt — hide once user has spoken ── */}
      {!agent.messages.some(m => m.role === 'user') && <div className="sample-question">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0, color:'var(--text-muted)'}}>
          {/* Person head */}
          <circle cx="9" cy="7" r="3" />
          {/* Person body */}
          <path d="M3 21v-2a5 5 0 0 1 5-5h2" />
          {/* Sound waves from mouth */}
          <path d="M15 10.5a2.5 2.5 0 0 1 0 3" />
          <path d="M18 8.5a6 6 0 0 1 0 7" />
        </svg>
        {sampleQ}
      </div>}

      {/* ── Google Maps (above pills) ── */}
      <div className="maps-section">
        {mapsUrl ? (
          <div
            className={`maps-frame-wrap${mapExpanded ? ' maps-frame-wrap--expanded' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              if (mapCollapseTimer.current) clearTimeout(mapCollapseTimer.current)
              setMapExpanded(v => {
                if (!v) {
                  // expanding — auto-collapse after 5s
                  mapCollapseTimer.current = setTimeout(() => setMapExpanded(false), 5000)
                }
                return !v
              })
            }}
          >
            <iframe
              src={mapsUrl}
              title="Your location"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ pointerEvents: 'none' }}
            />
            <div className="maps-expand-hint">
              {mapExpanded ? '▲ tap to collapse' : '▼ tap to expand'}
            </div>
          </div>
        ) : (
          <button className="maps-enable-btn" onClick={(e) => { e.stopPropagation(); geo.requestLocation() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
            </svg>
            Enable location to see map
          </button>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div className="bottom-controls">
        <div className="toggle-row">
          <button className="toggle-pill" onClick={(e) => { e.stopPropagation(); setIsLangOpen(true) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            {currentLang?.nativeName ?? language}
          </button>

          <button className="toggle-pill toggle-pill--sms" onClick={(e) => { e.stopPropagation(); setIsSmsOpen(true); setSmsSent(false) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Text me instead
          </button>
        </div>

        <div className="bottom-hint">
          {isListening ? 'Listening — tap to send early'
            : isSpeaking || isThinking ? ''
            : agent.isConnected ? 'Tap the mic to speak'
            : agent.connectionState === 'reconnecting' ? 'Reconnecting…'
            : 'Disconnected'}
        </div>
      </div>

      {/* ── Language sheet ── */}
      {isLangOpen && (
        <div className="sheet-overlay" onClick={() => setIsLangOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Choose language</div>
            <div className="lang-grid">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  className={`lang-pill${language === lang.code ? ' lang-pill--active' : ''}`}
                  onClick={() => handleLanguageSelect(lang)}
                >
                  {lang.nativeName}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SMS sheet ── */}
      {isSmsOpen && (
        <div className="sheet-overlay" onClick={() => setIsSmsOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Text the airport assistant</div>
            {smsSent ? (
              <div className="sms-success">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <p>Check your messages! You can continue this conversation via SMS.</p>
                {TWILIO_NUMBER && (
                  <p className="sms-number">Or text us directly at <strong>{TWILIO_NUMBER}</strong></p>
                )}
              </div>
            ) : (
              <>
                <p className="sms-desc">Enter your phone number and we'll text you so you can chat with the airport assistant via SMS.</p>
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
                  <p className="sms-or">Or text us directly at <strong>{TWILIO_NUMBER}</strong></p>
                )}
                <button
                  className="sms-submit"
                  onClick={handleSmsSubmit}
                  disabled={!smsPhone.trim()}
                >
                  Send me the link
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
