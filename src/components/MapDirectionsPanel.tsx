import { useMemo } from 'react'
import type { MapActionPayload } from '../lib/types'
import { GOOGLE_MAPS_API_KEY } from '../lib/constants'

interface Props {
  action: MapActionPayload
  userLat?: number
  userLng?: number
  onDismiss: () => void
}

function buildEmbedUrl(action: MapActionPayload, userLat?: number, userLng?: number): string | null {
  if (action.type === 'clear') return null

  if (action.type === 'show_destination') {
    const { lat, lng } = action.destination
    if (GOOGLE_MAPS_API_KEY) {
      return `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${lat},${lng}&zoom=18`
    }
    return `https://maps.google.com/maps?q=${lat},${lng}&z=18&output=embed`
  }

  if (action.type === 'show_directions') {
    const { lat: dLat, lng: dLng } = action.destination
    const originLat = action.origin?.lat ?? userLat
    const originLng = action.origin?.lng ?? userLng

    if (originLat != null && originLng != null) {
      if (GOOGLE_MAPS_API_KEY) {
        return `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}&origin=${originLat},${originLng}&destination=${dLat},${dLng}&mode=walking`
      }
      return `https://maps.google.com/maps?saddr=${originLat},${originLng}&daddr=${dLat},${dLng}&output=embed`
    }
    // No origin — just show destination pin
    if (GOOGLE_MAPS_API_KEY) {
      return `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${dLat},${dLng}&zoom=18`
    }
    return `https://maps.google.com/maps?q=${dLat},${dLng}&z=18&output=embed`
  }

  if (action.type === 'show_route' && action.stops.length >= 2) {
    const first = action.stops[0]
    const last = action.stops[action.stops.length - 1]
    if (GOOGLE_MAPS_API_KEY) {
      const waypoints = action.stops.slice(1, -1).map(s => `${s.lat},${s.lng}`).join('|')
      const waypointParam = waypoints ? `&waypoints=${waypoints}` : ''
      return `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}${waypointParam}&mode=walking`
    }
    return `https://maps.google.com/maps?saddr=${first.lat},${first.lng}&daddr=${last.lat},${last.lng}&output=embed`
  }

  return null
}

export function MapDirectionsPanel({ action, userLat, userLng, onDismiss }: Props) {
  const embedUrl = useMemo(
    () => buildEmbedUrl(action, userLat, userLng),
    [action, userLat, userLng]
  )

  if (!embedUrl) return null

  const destinationName = 'destination' in action ? action.destination.name : ''
  const isDirections = action.type === 'show_directions' || action.type === 'show_route'

  return (
    <div className="map-directions-panel">
      <div className="map-directions-header">
        <div className="map-directions-label">
          {isDirections ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
            </svg>
          )}
          <span>
            {isDirections ? 'Directions to ' : ''}
            <strong>{destinationName}</strong>
          </span>
        </div>
        <button
          className="map-directions-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss map"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="map-directions-embed">
        <iframe
          src={embedUrl}
          title={isDirections ? `Directions to ${destinationName}` : destinationName}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
    </div>
  )
}
