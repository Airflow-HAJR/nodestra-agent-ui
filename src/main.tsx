import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { completeAuthPopup, isAuthPopup } from './lib/authPopup'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

const isOrbTest = new URLSearchParams(window.location.search).has('orbtest')

async function render() {
  // The sign-in popup loads this same bundle. It must not boot the app — that
  // would open a second microphone, a second websocket, and a second greeting
  // in a window the user is about to never see again.
  if (isAuthPopup()) {
    rootElement!.innerHTML = '<div class="auth-popup-note">Signing you in…</div>'
    await completeAuthPopup()
    return
  }

  if (isOrbTest) {
    const { OrbTestPage } = await import('./components/orbtest/OrbTestPage')
    createRoot(rootElement!).render(
      <StrictMode>
        <OrbTestPage />
      </StrictMode>,
    )
    return
  }
  createRoot(rootElement!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

render()
