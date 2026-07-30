import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

const isOrbTest = new URLSearchParams(window.location.search).has('orbtest')

async function render() {
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
