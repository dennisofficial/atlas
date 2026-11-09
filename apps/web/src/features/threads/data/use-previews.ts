'use client'

import { useCallback, useMemo } from 'react'

import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { activeTabOf, currentUrlOf, NEW_TAB_URL } from './preview-browser/browser-model'
import { openUrlIn } from './preview-browser/open-in-browser'
import { previewCallbackUrlOf } from './preview-browser/preview-callback'
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
    (url: string) =>
      update(({ state }) => {
        const active = activeTabOf(state)
        const currentUrl = active === undefined ? NEW_TAB_URL : currentUrlOf(active)
        const callback = previewCallbackUrlOf({ url, currentUrl, ports })
        return openUrlIn({ state, url: callback ?? url })
      }),
    [update, ports],
  )
  return { ports, loaded: roster !== null, openUrl }
}
