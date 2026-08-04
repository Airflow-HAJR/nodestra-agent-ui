export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export interface Message {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: Date
  language?: string
}

export interface Language {
  code: string
  name: string
  nativeName: string
  rtl?: boolean
}

export interface VoiceAgentConfig {
  serverUrl: string
  language: string
  userId?: string
}

export interface GeolocationState {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  error: string | null
  permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  loading: boolean
}

export interface MapDestination {
  name: string
  lat: number
  lng: number
}

// POI type as reported by the backend's map_engine _TYPE_PRIORITY table —
// left as `string` rather than a closed union since the map data drives it.
export type PoiKind = string

export interface TrajectoryStop {
  id: string
  name: string
  lat: number
  lng: number
  kind: PoiKind
  isPortal: boolean // true for the elevator/escalator/stairs used to leave this floor
  index: number      // stable position within the segment's stop list — the number shown on the map marker
}

export interface TrajectorySegment {
  levelName: string
  stops: TrajectoryStop[]       // in travel order; last stop is portalOut (if not the final segment)
  portalOut: TrajectoryStop | null
}

export interface TrajectoryPayload {
  type: 'show_trajectory'
  routeId: string
  origin: MapDestination
  destination: MapDestination
  segments: TrajectorySegment[]
  activeSegmentIndex: number
  activeStopIndex: number // index (within the active segment) of the stop the user is currently heading to — highlighted distinctly
  etaMinutes: number | null
}

export type MapActionPayload =
  | { type: 'show_destination'; destination: MapDestination }
  | { type: 'show_directions'; destination: MapDestination; origin?: { lat: number; lng: number } }
  | { type: 'show_route'; stops: MapDestination[] }
  | TrajectoryPayload
  | { type: 'clear' }

export interface CheckpointPrompt {
  routeId: string
  segmentIndex: number
  stopIndex: number
  poiName: string
  promptText: string
  gpsTarget: { lat: number; lng: number } | null
}

export interface CheckpointResolved {
  routeId: string
  segmentIndex: number
  stopIndex: number
  nextSegmentIndex: number
}

// WebSocket message types — inbound from server
export type ServerMessage =
  | { type: 'transcript'; text: string; role: 'user' | 'agent' }
  | { type: 'partial_transcript'; text: string; final: boolean }
  | { type: 'audio'; data: string; format: 'mp3' | 'wav' | 'ogg' }
  | { type: 'status'; state: AgentState; label?: string }
  | { type: 'error'; message: string }
  | { type: 'map_action'; action: MapActionPayload }
  | ({ type: 'checkpoint_prompt' } & CheckpointPrompt)
  | ({ type: 'checkpoint_resolved' } & CheckpointResolved)
  // Auto mode only: what Deepgram actually heard, so the UI can follow along.
  | { type: 'language_detected'; language: string }
  // Reply to set_language — the same message ids, retranslated.
  | { type: 'history_translated'; language: string; messages: { id: string; text: string }[] }

// WebSocket message types — outbound to server
export type ClientMessage =
  | { type: 'audio'; data: string; language: string; format: 'webm' | 'ogg' | 'mp4' }
  | { type: 'audio_start'; language: string }
  | { type: 'audio_chunk'; data: string }
  | { type: 'audio_end' }
  | { type: 'text'; text: string; language: string }
  | { type: 'config'; language: string; userId?: string; greet?: boolean }
  | {
      type: 'set_language'
      language: string
      history: { id: string; role: 'user' | 'agent'; text: string }[]
      speakId?: string  // the agent turn that was mid-playback, to restart in the new language
    }
  | { type: 'ping' }
  | { type: 'location'; lat: number; lng: number; accuracy: number; timestamp: number }
