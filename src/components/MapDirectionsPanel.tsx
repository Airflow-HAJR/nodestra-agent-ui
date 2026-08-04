import { useEffect, useRef, useState } from 'react'
import type { MapActionPayload } from '../lib/types'
import { GOOGLE_MAPS_API_KEY } from '../lib/constants'
import { strings } from '../lib/i18n'
import { loadGoogleMaps } from '../lib/googleMapsLoader'

interface Props {
  action: MapActionPayload
  userLat?: number
  userLng?: number
  uiLang: string
  onDismiss: () => void
}

const ROUTE_COLOR = '#4285F4' // Google-blue — the route line must always render in this color
const ORIGIN_COLOR = '#4285F4'
const DESTINATION_COLOR = '#EA4335'
const WAYPOINT_COLOR = '#34A853'
const PORTAL_COLOR = '#FBBC05' // elevator/escalator/stairs — the checkpoint the user is heading to on this floor
const ACTIVE_COLOR = '#9C27B0' // the specific stop the user is currently being guided to — always wins over other colors
const USER_DOT_COLOR = '#1A73E8' // "you are here" — Google's own blue-dot blue

// Renders markers + a manually-drawn polyline on a real Google Maps JS
// instance. We do NOT use the Embed API's `directions` mode here — Google's
// road/walking router frequently can't find a path between indoor airport
// coordinates that sit only a few dozen meters apart, and silently falls
// back to showing bare pins with no connecting line. Drawing the line
// ourselves (straight between our own known waypoints) guarantees the route
// is always visible, in blue, regardless of what Google's router thinks.
function MapCanvas({ action, userLat, userLng, uiLang }: { action: MapActionPayload; userLat?: number; userLng?: number; uiLang: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const overlaysRef = useRef<any[]>([])

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || action.type === 'clear') return
    let cancelled = false

    loadGoogleMaps(GOOGLE_MAPS_API_KEY).then((google) => {
      if (cancelled || !containerRef.current) return

      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          zoom: 18,
          center: { lat: 0, lng: 0 },
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        })
      }
      const map = mapRef.current

      overlaysRef.current.forEach(o => o.setMap(null))
      overlaysRef.current = []

      const bounds = new google.maps.LatLngBounds()

      const addMarker = (pos: { lat: number; lng: number }, label: string, color: string, active?: boolean) => {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          label: label ? { text: label, color: '#fff', fontSize: active ? '13px' : '11px', fontWeight: '700' } : undefined,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: active ? 14 : 10,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: active ? 3 : 2,
          },
          zIndex: active ? 20 : color === DESTINATION_COLOR ? 10 : 5,
        })
        overlaysRef.current.push(marker)
        bounds.extend(pos)
      }

      // The "you are here" dot, drawn the way Google Maps draws it: a solid
      // blue core with a white collar, sitting on a soft accuracy halo. It is
      // deliberately NOT a numbered stop — the user's own position isn't
      // somewhere they have to walk to, and numbering it made stop 1 look
      // like a destination.
      const addUserDot = (pos: { lat: number; lng: number }) => {
        const halo = new google.maps.Marker({
          position: pos,
          map,
          clickable: false,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 22,
            fillColor: USER_DOT_COLOR,
            fillOpacity: 0.16,
            strokeWeight: 0,
          },
          zIndex: 28,
        })
        const dot = new google.maps.Marker({
          position: pos,
          map,
          clickable: false,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: USER_DOT_COLOR,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 3,
          },
          // Above every route marker: it should never end up hidden behind a
          // stop that happens to sit on the same spot.
          zIndex: 30,
        })
        overlaysRef.current.push(halo, dot)
        bounds.extend(pos)
      }

      const drawRoute = (path: { lat: number; lng: number }[]) => {
        const line = new google.maps.Polyline({
          path,
          map,
          strokeColor: ROUTE_COLOR,
          strokeOpacity: 0.9,
          strokeWeight: 5,
        })
        overlaysRef.current.push(line)
      }

      if (action.type === 'show_destination') {
        addMarker(action.destination, '', DESTINATION_COLOR)
        map.setCenter(action.destination)
        map.setZoom(18)
        return
      }

      if (action.type === 'show_directions') {
        const origin = action.origin ?? (userLat != null && userLng != null ? { lat: userLat, lng: userLng } : null)
        addMarker(action.destination, '', DESTINATION_COLOR)
        if (origin) {
          addUserDot(origin)
          drawRoute([origin, action.destination])
          map.fitBounds(bounds, 48)
        } else {
          map.setCenter(action.destination)
          map.setZoom(18)
        }
        return
      }

      if (action.type === 'show_route' && action.stops.length >= 2) {
        action.stops.forEach((stop, i) => {
          const color = i === 0 ? ORIGIN_COLOR : i === action.stops.length - 1 ? DESTINATION_COLOR : WAYPOINT_COLOR
          addMarker(stop, String(i + 1), color)
        })
        drawRoute(action.stops)
        map.fitBounds(bounds, 48)
        return
      }

      if (action.type === 'show_trajectory') {
        // Only the active floor's leg is drawn — later floors aren't
        // reachable yet, so showing them would just be confusing. Every
        // stop keeps a stable number (its position in the full route, not
        // just what's currently visible) so the agent can say "stop 3" and
        // it always matches this label. The final red destination pin only
        // appears once we're on the last segment; a floor-changing portal
        // is amber; and whichever stop the user is being guided to RIGHT
        // NOW is highlighted in purple regardless of its other role.
        const seg = action.segments[action.activeSegmentIndex] ?? action.segments[0]
        if (seg && seg.stops.length > 0) {
          const isFinalSegment = action.activeSegmentIndex === action.segments.length - 1
          // Stop 0 of the very first segment is where the route starts, i.e.
          // where the user is standing — that one becomes the blue dot rather
          // than a numbered pin. On later segments stop 0 is a portal exit on
          // a new floor, which is a real place to walk to, so it keeps its
          // number.
          const originIsUser = action.activeSegmentIndex === 0
          seg.stops.forEach((stop, i) => {
            const isFirst = i === 0
            if (isFirst && originIsUser) {
              addUserDot(stop)
              return
            }
            const isLastOfSegment = i === seg.stops.length - 1
            const isActive = stop.index === action.activeStopIndex
            let color: string = WAYPOINT_COLOR
            if (isFirst) color = ORIGIN_COLOR
            else if (isLastOfSegment && isFinalSegment) color = DESTINATION_COLOR
            else if (stop.isPortal) color = PORTAL_COLOR
            if (isActive) color = ACTIVE_COLOR
            addMarker(stop, String(stop.index + 1), color, isActive)
          })
          drawRoute(seg.stops)
          map.fitBounds(bounds, 48)
        }
      }
    }).catch(() => { /* Maps SDK failed to load — panel just stays blank */ })

    return () => { cancelled = true }
  }, [action, userLat, userLng])

  if (!GOOGLE_MAPS_API_KEY) {
    return <div className="map-sheet-empty">{strings(uiLang).mapsKeyMissing}</div>
  }

  return <div ref={containerRef} className="map-canvas" />
}

function MapHeader({
  destinationName, isDirections, expanded, uiLang,
  onExpand, onDismiss,
}: {
  destinationName: string
  isDirections: boolean
  expanded: boolean
  uiLang: string
  onExpand: () => void
  onDismiss: () => void
}) {
  const S = strings(uiLang)
  return (
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
        <span>{isDirections ? `${S.directionsTo} ` : ''}<strong>{destinationName}</strong></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button className="map-directions-dismiss" onClick={onExpand} aria-label={expanded ? S.collapseMap : S.expandMap}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {expanded ? (
              <>
                <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
              </>
            ) : (
              <>
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </>
            )}
          </svg>
        </button>
        <button className="map-directions-dismiss" onClick={onDismiss} aria-label={S.dismissMap}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export function MapDirectionsPanel({ action, userLat, userLng, uiLang, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false)
  const S = strings(uiLang)

  if (action.type === 'clear') return null

  const destinationName = action.type === 'show_route'
    ? action.stops[action.stops.length - 1]?.name ?? ''
    : action.destination.name
  const isDirections = action.type === 'show_directions' || action.type === 'show_route' || action.type === 'show_trajectory'
  const floorLabel = action.type === 'show_trajectory' && action.segments.length > 1
    ? `${action.segments[action.activeSegmentIndex]?.levelName ?? ''} · ${S.floor} ${action.activeSegmentIndex + 1}/${action.segments.length}`
    : null

  return (
    <>
      {/* Collapsed inline panel */}
      <div className="map-directions-panel">
        <MapHeader
          destinationName={destinationName}
          isDirections={isDirections}
          uiLang={uiLang}
          expanded={false}
          onExpand={() => setExpanded(true)}
          onDismiss={onDismiss}
        />
        <div className="map-directions-embed">
          {floorLabel && <div className="map-floor-indicator">{floorLabel}</div>}
          <MapCanvas action={action} userLat={userLat} userLng={userLng} uiLang={uiLang} />
        </div>
      </div>

      {/* Expanded modal overlay */}
      {expanded && (
        <div className="map-expand-backdrop" onClick={() => setExpanded(false)}>
          <div className="map-expand-modal" onClick={e => e.stopPropagation()}>
            <MapHeader
              destinationName={destinationName}
              isDirections={isDirections}
              uiLang={uiLang}
              expanded={true}
              onExpand={() => setExpanded(false)}
              onDismiss={() => { setExpanded(false); onDismiss() }}
            />
            <div className="map-expand-embed">
              {floorLabel && <div className="map-floor-indicator">{floorLabel}</div>}
              <MapCanvas action={action} userLat={userLat} userLng={userLng} uiLang={uiLang} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
