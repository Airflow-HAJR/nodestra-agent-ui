// Minimal singleton loader for the Google Maps JavaScript API. We draw our
// own markers/polylines (rather than using the Embed API's directions mode)
// because Google's road/walking directions frequently fail to route between
// indoor airport coordinates that are only a few dozen meters apart — the
// Embed API then just shows pins with no connecting line. Drawing the route
// ourselves guarantees a visible line regardless of what Google's routing
// engine thinks is walkable.
//
// Typed as `any` deliberately — adding @types/google.maps is unnecessary
// weight for the handful of Maps JS calls this app makes.
declare global {
  interface Window {
    google?: any
  }
}

let loadPromise: Promise<any> | null = null

export function loadGoogleMaps(apiKey: string): Promise<any> {
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google)
      return
    }

    const existing = document.getElementById('google-maps-js-sdk') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps JS SDK')))
      return
    }

    const script = document.createElement('script')
    script.id = 'google-maps-js-sdk'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
    script.async = true
    script.onload = () => resolve(window.google)
    script.onerror = () => reject(new Error('Failed to load Google Maps JS SDK'))
    document.head.appendChild(script)
  })

  return loadPromise
}
