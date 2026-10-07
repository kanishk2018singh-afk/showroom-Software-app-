import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Agar koi purana service-worker stuck ho gaya ho to app phir bhi khule —
// vite-plugin-pwa khud update handle karta hai (registerType: autoUpdate).
const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
