'use client'

import { ClerkProvider, useAuth } from '@clerk/nextjs'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

  if (!publishableKey) {
    return <>{children}</>
  }

  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>
}

export function ConvexProviders({ children }: { children: React.ReactNode }): React.JSX.Element {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  const [client] = useState(() => (convexUrl ? new ConvexReactClient(convexUrl) : null))

  if (!client) {
    return <>{children}</>
  }

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  )
}
