import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { loadCore } from './lib/data'
import App from './App'
import './index.css'

registerSW({ immediate: true })

// Begin assembling core data immediately (consumes the fetches index.html
// already started) rather than waiting for React to mount a provider.
loadCore().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
