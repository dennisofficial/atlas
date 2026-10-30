'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { sharedQueryClient } from './query-client'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(sharedQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
