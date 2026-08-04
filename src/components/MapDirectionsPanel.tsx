import { useEffect, useRef, useState } from 'react'
import { Navigation, MapPin, Maximize2, Minimize2, X } from 'lucide-react'
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
// Intermediate stops are deliberately neutral. They're places the route
// passes through, not places to aim for — green read as "arrived" and
// competed with the one stop that actually matters right now.
const WAYPOINT_COLOR = '#80868B'
const PORTAL_COLOR = '#FBBC05' // elevator/escalator/stairs — the checkpoint the user is heading to on this floor
const ACTIVE_COLOR = '#9C27B0' // the specific stop the user is currently being guided to — always wins over other colors
const USER_DOT_COLOR = '#1A73E8' // "you are here" — Google's own blue-dot blue

// Fit padding. Generous at the top and sides because the name chips extend
// above and beyond their pins — with a uniform 48 the chip on an edge stop
// was drawn half outside the canvas.
const LABEL_PADDING = { top: 78, right: 64, bottom: 40, left: 64 }

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
      const S = strings(uiLang)

      // A name chip floating above a pin. Marker `label` can't do this — it
      // draws *inside* the circle — so this is a real DOM node positioned by
      // the map's own projection, which also means it can be styled and can
      // wrap long POI names instead of being clipped to the pin.
      class PoiLabel extends google.maps.OverlayView {
        pos: { lat: number; lng: number }
        text: string
        variant: string
        div: HTMLDivElement | null = null

        constructor(pos: { lat: number; lng: number }, text: string, variant: string) {
          super()
          this.pos = pos
          this.text = text
          this.variant = variant
        }

        onAdd() {
          const div = document.createElement('div')
          div.className = `map-poi-label map-poi-label--${this.variant}`
          div.textContent = this.text
          this.div = div
          // floatPane sits above the marker pane, so a chip never ends up
          // underneath a pin that happens to overlap it.
          this.getPanes()?.floatPane.appendChild(div)
        }

        draw() {
          if (!this.div) return
          const point = this.getProjection()?.fromLatLngToDivPixel(
            new google.maps.LatLng(this.pos.lat, this.pos.lng)
          )
          if (!point) return
          this.div.style.left = `${point.x}px`
          this.div.style.top = `${point.y}px`
        }

        onRemove() {
          this.div?.remove()
          this.div = null
        }
      }

      // Guards against two chips stacking on one pin — the stop the user is
      // walking to is often also the segment's last stop, and drawing both
      // labels would just render the name twice, offset by a pixel.
      const labelled = new Set<string>()
      const addLabel = (pos: { lat: number; lng: number }, text: string | undefined, variant: 'active' | 'endpoint') => {
        // Trimmed: POI names come from the map data with stray whitespace, and
        // a chip is sized to its text, so a trailing space is a visible gap.
        const name = text?.trim()
        if (!name) return
        const key = `${pos.lat},${pos.lng}`
        if (labelled.has(key)) return
        labelled.add(key)
        const overlay = new PoiLabel(pos, name, variant)
        overlay.setMap(map)
        overlaysRef.current.push(overlay)
      }

      // Deliberately unlabelled. The dots were numbered, but the number was
      // never information the user needed — the route line already gives the
      // order, and the stop that matters is the highlighted one, which now
      // carries its actual name.
      const addMarker = (pos: { lat: number; lng: number }, color: string, active?: boolean) => {
        const marker = new google.maps.Marker({
          position: pos,
          map,
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
        addMarker(action.destination, DESTINATION_COLOR)
        addLabel(action.destination, action.destination.name, 'endpoint')
        map.setCenter(action.destination)
        map.setZoom(18)
        return
      }

      if (action.type === 'show_directions') {
        const origin = action.origin ?? (userLat != null && userLng != null ? { lat: userLat, lng: userLng } : null)
        addMarker(action.destination, DESTINATION_COLOR)
        addLabel(action.destination, action.destination.name, 'endpoint')
        if (origin) {
          addUserDot(origin)
          // The origin here is the user's own position, not a place — name it
          // as such rather than leaving the only unlabelled pin on the map.
          addLabel(origin, S.you, 'endpoint')
          drawRoute([origin, action.destination])
          map.fitBounds(bounds, LABEL_PADDING)
        } else {
          map.setCenter(action.destination)
          map.setZoom(18)
        }
        return
      }

      if (action.type === 'show_route' && action.stops.length >= 2) {
        action.stops.forEach((stop, i) => {
          const color = i === 0 ? ORIGIN_COLOR : i === action.stops.length - 1 ? DESTINATION_COLOR : WAYPOINT_COLOR
          addMarker(stop, color)
        })
        addLabel(action.stops[0], action.stops[0].name, 'endpoint')
        const lastStop = action.stops[action.stops.length - 1]
        addLabel(lastStop, lastStop.name, 'endpoint')
        drawRoute(action.stops)
        map.fitBounds(bounds, LABEL_PADDING)
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
          const firstStop = seg.stops[0]
          const lastStop = seg.stops[seg.stops.length - 1]

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
            addMarker(stop, color, isActive)
            // Named first, so that when the stop being walked to is also an
            // endpoint it gets the active chip rather than the plain one.
            if (isActive) addLabel(stop, stop.name, 'active')
          })

          // Where the leg starts and where it ends, named at all times. On the
          // first segment that start is the user's own position — the chip says
          // "You", not the POI the router happened to snap them to, which read
          // as a place they still had to walk to. On the last, the end is the
          // destination.
          addLabel(firstStop, originIsUser ? S.you : firstStop.name, 'endpoint')
          addLabel(lastStop, isFinalSegment ? action.destination.name : lastStop.name, 'endpoint')

          drawRoute(seg.stops)
          map.fitBounds(bounds, LABEL_PADDING)
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
          <Navigation size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <MapPin size={14} strokeWidth={2} aria-hidden="true" />
        )}
        <span>{isDirections ? `${S.directionsTo} ` : ''}<strong>{destinationName}</strong></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button className="map-directions-dismiss" onClick={onExpand} aria-label={expanded ? S.collapseMap : S.expandMap}>
          {expanded
            ? <Minimize2 size={14} strokeWidth={2.5} aria-hidden="true" />
            : <Maximize2 size={14} strokeWidth={2.5} aria-hidden="true" />}
        </button>
        <button className="map-directions-dismiss" onClick={onDismiss} aria-label={S.dismissMap}>
          <X size={14} strokeWidth={2.5} aria-hidden="true" />
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
