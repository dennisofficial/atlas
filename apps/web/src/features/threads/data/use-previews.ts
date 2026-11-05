'use client'

import { useCallback, useMemo } from 'react'

import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { openUrlIn } from './preview-browser/open-in-browser'
import { usePreviewBrowser } from './preview-browser/use-preview-browser'
import { previewPortsOf } from './preview-ports'
import type { RosterChannel } from './roster-source'
import { useRoster } from './use-roster'

export type PreviewsState = {
  ports: PreviewPort[]
  loaded: boolean
  openUrl: (url: string) => void
}

export const EMPTY_PREVIEWS: PreviewsState = {
  ports: [],
  loaded: false,
  openUrl: () => undefined,
}

export function usePreviews(args: {
  channel: RosterChannel | null
  threadId: string
}): PreviewsState {
  const { channel, threadId } = args
  const roster = useRoster(channel)
  const ports = useMemo(() => previewPortsOf(roster), [roster])
  const { update } = usePreviewBrowser(threadId)
  const openUrl = useCallback(
    (url: string) => update(({ state, now }) => openUrlIn({ state, url, now })),
    [update],
  )
  return { ports, loaded: roster !== null, openUrl }
}
