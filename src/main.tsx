import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n' // load the catalogs before any component renders
import App from './App.tsx'
import { SessionProvider } from './lib/session'
import { loadDeployedSettings } from './lib/deployedSettings'

// Read the deployment's settings.json before rendering, so getService() stays
// synchronous. Never rejects and never waits past its cap.
void loadDeployedSettings().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </StrictMode>,
  )
})
