import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/oakland/',
  plugins: [react(), tailwindcss()],
  preview: {
    // vite preview rejects requests for hosts it doesn't recognize (DNS
    // rebinding protection) — allow the production domain through.
    allowedHosts: ['agent.nodestra.com'],
  },
})
