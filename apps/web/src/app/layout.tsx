import type { Metadata } from 'next'
import { Providers } from '../components/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deskbinder',
  description:
    'Run Codex jobs against local repositories from a Linux-first desktop worker and web companion.'
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
