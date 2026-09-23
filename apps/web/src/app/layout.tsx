import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Atlas Cloud',
  description: 'Sign in to Atlas Cloud',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen justify-center px-4 py-16">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
        />
        <main className="flex w-full max-w-3xl flex-col gap-6">
          <header className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold text-foreground">Atlas</span>
            <span className="text-xs text-hint">Cloud</span>
          </header>
          {children}
        </main>
      </body>
    </html>
  )
}
