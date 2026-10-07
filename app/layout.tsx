import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: 'Task Manager' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink antialiased">{children}</body>
    </html>
  )
}
