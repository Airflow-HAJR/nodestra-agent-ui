import { useState, useCallback, useRef } from 'react'
import type { GeolocationState } from '../lib/types'

interface GeolocationHook extends GeolocationState {
  requestLocation: () => void
  clearError: () => void
}

export function useGeolocation(): GeolocationHook {
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    error: null,
    permission: 'unknown',
    loading: false,
  })

  const watchIdRef = useRef<number | null>(null)

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState(prev => ({
        ...prev,
        error: 'Geolocation is not supported by your browser.',
        permission: 'denied',
      }))
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))

    // Clear existing watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setState({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          error: null,
          permission: 'granted',
          loading: false,
        })
      },
      (err) => {
        let message: string
        let permission: GeolocationState['permission'] = 'denied'

        switch (err.code) {
          case GeolocationPositionError.PERMISSION_DENIED:
            message = 'Location access denied. Tap to enable in your browser settings.'
            permission = 'denied'
            break
          case GeolocationPositionError.POSITION_UNAVAILABLE:
            message = 'Your location is currently unavailable.'
            permission = 'granted'
            break
          case GeolocationPositionError.TIMEOUT:
            message = 'Location request timed out. Please try again.'
            permission = 'granted'
            break
          default:
            message = 'An unknown location error occurred.'
        }

        setState(prev => ({
          ...prev,
          error: message,
          permission,
          loading: false,
        }))
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    )
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  return { ...state, requestLocation, clearError }
}
