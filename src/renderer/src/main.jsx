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
import { installWebBridge } from './lib/webBridge'
import ReceiptViewer from './components/shell/ReceiptViewer'

// In a browser (the internet way in) there is no preload bridge: provide the same one.
installWebBridge()
installModalChrome()
installKeyboard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <App />
        {window.api?.isWeb && <ReceiptViewer />}
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
)
