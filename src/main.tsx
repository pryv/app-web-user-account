import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n' // load the catalogs before any component renders
import App from './App.tsx'
import { SessionProvider } from './lib/session'
import { getThemeSettings, loadDeployedSettings } from './lib/deployedSettings'
import { applyTheme, readStoredChoice, resolveChoice } from './lib/theme'

// Read the deployment's settings.json before rendering, so getService() stays
// synchronous. Never rejects and never waits past its cap.
// The theme is applied before the first render, so the operator's default
// never flashes the other palette.
void loadDeployedSettings().then(() => {
  const theme = getThemeSettings()
  applyTheme(resolveChoice(readStoredChoice(), theme.default, theme.userChoice))
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
