import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

import { Toaster } from '@dltech/atlas-ui/components/sonner'

import { ProtoFrameListener } from '@/proto/bridge'

import './globals.css'

export const metadata: Metadata = {
  title: 'Atlas Prototype',
  description: 'Clickable north-star prototype of Atlas Cloud',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Geist:wght@400;500;600;700&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          themes={['dark', 'light']}
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <ProtoFrameListener />
        </ThemeProvider>
      </body>
    </html>
  )
}
