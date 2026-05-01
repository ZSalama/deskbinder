import type { Metadata } from 'next'
import { Providers } from '../components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deskbinder Web',
  description: 'Small web companion app for the shared Deskbinder Convex backend.'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
