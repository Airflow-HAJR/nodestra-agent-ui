import { useEffect, useRef } from 'react'
import { LANGUAGES } from '../lib/constants'
import type { Language } from '../lib/types'

interface LanguageSelectorProps {
  isOpen: boolean
  currentLanguage: string
  onSelect: (lang: Language) => void
  onClose: () => void
}

export function LanguageSelector({ isOpen, currentLanguage, onSelect, onClose }: LanguageSelectorProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Trap focus inside sheet when open
  useEffect(() => {
    if (isOpen && sheetRef.current) {
      sheetRef.current.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const selectedLang = LANGUAGES.find(l => l.code === currentLanguage)

  return (
    <div className="lang-overlay" ref={overlayRef} onClick={onClose} aria-modal="true" role="dialog" aria-label="Select language">
      <div
        className="lang-sheet"
        ref={sheetRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="lang-handle" />

        <div className="lang-header">
          <h2 className="lang-title">Choose Language</h2>
          <button className="lang-close" onClick={onClose} aria-label="Close language selector">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {selectedLang && (
          <p className="lang-current">
            Currently: <span className="lang-current-name">{selectedLang.nativeName}</span>
          </p>
        )}

        <div className="lang-grid" role="listbox" aria-label="Languages">
          {LANGUAGES.map((lang) => {
            const isSelected = lang.code === currentLanguage
            return (
              <button
                key={lang.code}
                className={`lang-pill ${isSelected ? 'lang-pill--selected' : ''}`}
                onClick={() => {
                  onSelect(lang)
                  onClose()
                }}
                role="option"
                aria-selected={isSelected}
                dir={lang.rtl ? 'rtl' : undefined}
              >
                <span className="lang-pill-native">{lang.nativeName}</span>
                {lang.nativeName !== lang.name && (
                  <span className="lang-pill-english">{lang.name}</span>
                )}
                {isSelected && (
                  <span className="lang-pill-check" aria-hidden="true">✓</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
