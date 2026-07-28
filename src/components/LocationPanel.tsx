import { useState } from 'react'
import type { GeolocationState } from '../lib/types'
import { GOOGLE_MAPS_API_KEY } from '../lib/constants'

interface LocationPanelProps {
  geo: GeolocationState
  onRequestLocation: () => void
}

export function LocationPanel({ geo, onRequestLocation }: LocationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const hasLocation = geo.latitude !== null && geo.longitude !== null
  const mapsEmbedUrl = hasLocation && GOOGLE_MAPS_API_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${geo.latitude},${geo.longitude}&zoom=16`
    : hasLocation
      ? `https://maps.google.com/maps?q=${geo.latitude},${geo.longitude}&output=embed&z=16`
      : null

  const coordLabel = hasLocation
    ? `${geo.latitude!.toFixed(5)}, ${geo.longitude!.toFixed(5)}`
    : null

  return (
    <div className={`location-panel ${isExpanded ? 'location-panel--expanded' : ''}`}>
      {/* Collapsed toggle row */}
      <button
        className="location-toggle"
        onClick={() => {
          if (!hasLocation && !geo.loading) {
            onRequestLocation()
          } else {
            setIsExpanded(prev => !prev)
          }
        }}
        aria-expanded={isExpanded}
        aria-label={hasLocation ? 'Toggle location panel' : 'Enable location'}
      >
        <span className="location-toggle-icon" aria-hidden="true">
          {geo.loading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="location-spin">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          ) : hasLocation ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
              <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" />
            </svg>
          )}
        </span>

        <span className="location-toggle-label">
          {geo.loading && 'Getting location...'}
          {!geo.loading && hasLocation && coordLabel}
          {!geo.loading && !hasLocation && geo.permission === 'denied' && 'Location blocked'}
          {!geo.loading && !hasLocation && geo.permission !== 'denied' && 'Share location'}
        </span>

        {hasLocation && (
          <span className="location-toggle-arrow" aria-hidden="true">
            {isExpanded ? '▲' : '▼'}
          </span>
        )}
      </button>

      {/* Error state */}
      {geo.error && (
        <div className="location-error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{geo.error}</span>
        </div>
      )}

      {/* Map embed — shown when expanded */}
      {isExpanded && hasLocation && mapsEmbedUrl && (
        <div className="location-map-wrap">
          <iframe
            className="location-map"
            src={mapsEmbedUrl}
            title="Your location on Google Maps"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
          <div className="location-map-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
            </svg>
            OAK Airport
          </div>
        </div>
      )}

      {/* Location denied — show help */}
      {isExpanded && geo.permission === 'denied' && (
        <div className="location-denied-help">
          <p>To enable location:</p>
          <ol>
            <li>Tap the lock icon in your browser address bar</li>
            <li>Set Location to "Allow"</li>
            <li>Refresh the page</li>
          </ol>
        </div>
      )}
    </div>
  )
}
