'use client'

import { useMemo, type ReactNode } from 'react'

import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import type { PreviewsState } from '@/features/threads/data/use-previews'
import { PreviewsProvider } from '@/features/threads/panel/previews-context'

import { openBrowserUrl } from './open-browser'

export function SessionPreviewsProvider(props: {
  sessionId: string
  ports: readonly PreviewPort[]
  loaded: boolean
  onOpened: () => void
  children: ReactNode
}) {
  const { sessionId, ports, loaded, onOpened, children } = props
  const value = useMemo<PreviewsState>(
    () => ({
      ports: [...ports],
      loaded,
      openUrl: (url) => {
        openBrowserUrl({ sessionId, url, ports })
        onOpened()
      },
    }),
    [sessionId, ports, loaded, onOpened],
  )
  return <PreviewsProvider value={value}>{children}</PreviewsProvider>
}
