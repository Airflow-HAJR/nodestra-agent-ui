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
  error: string | null
  permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  loading: boolean
}

// WebSocket message types — inbound from server
export type ServerMessage =
  | { type: 'transcript'; text: string; role: 'user' | 'agent' }
  | { type: 'audio'; data: string; format: 'mp3' | 'wav' | 'ogg' }
  | { type: 'status'; state: AgentState }
  | { type: 'error'; message: string }

// WebSocket message types — outbound to server
export type ClientMessage =
  | { type: 'audio'; data: string; language: string; format: 'webm' | 'ogg' | 'mp4' }
  | { type: 'config'; language: string; userId?: string }
  | { type: 'ping' }
