'use client'

import { useMemo, type ReactNode } from 'react'

import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import type { PreviewsState } from '@/features/threads/data/use-previews'
import { PreviewsProvider } from '@/features/threads/panel/previews-context'

export function SessionPreviewsProvider(props: {
  ports: readonly PreviewPort[]
  loaded: boolean
  onOpen: (url: string) => void
  children: ReactNode
}) {
  const { ports, loaded, onOpen, children } = props
  const value = useMemo<PreviewsState>(
    () => ({ ports: [...ports], loaded, openUrl: onOpen }),
    [ports, loaded, onOpen],
  )
  return <PreviewsProvider value={value}>{children}</PreviewsProvider>
}
