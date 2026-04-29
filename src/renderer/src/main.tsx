import './assets/main.css'

import { ClerkProvider } from '@clerk/react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { useAuth } from '@clerk/react'
import App from './App'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publishableKey && convex ? (
      <ClerkProvider publishableKey={publishableKey}>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConvexProviderWithClerk>
      </ClerkProvider>
    ) : (
      <App />
    )}
  </StrictMode>
)
