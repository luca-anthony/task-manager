import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Task Manager',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Tasks', statusBarStyle: 'default' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink antialiased">{children}</body>
    </html>
  )
}
