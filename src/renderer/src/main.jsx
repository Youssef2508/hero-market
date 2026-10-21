import '@fontsource-variable/cairo'
import './styles/index.css'

// Silence logs in production
if (import.meta.env.PROD) {
  console.log = () => {}
  console.info = () => {}
  console.warn = () => {}
  console.error = () => {}
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './theme/ThemeProvider'
import { installModalChrome } from './lib/modalChrome'
import { installKeyboard } from './lib/keyboard'

installModalChrome()
installKeyboard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
)
