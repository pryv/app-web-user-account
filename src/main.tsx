import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '@fontsource/roboto-condensed/400.css'
import '@fontsource/roboto-condensed/500.css'
import '@fontsource/roboto-condensed/700.css'
import './index.css'
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
