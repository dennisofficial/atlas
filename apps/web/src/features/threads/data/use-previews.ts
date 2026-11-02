'use client'

import { useCallback, useMemo, useState } from 'react'

import { selectedPortOf, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'

import { previewPortsOf, type PreviewLinkRoute } from './preview-ports'
import type { RosterChannel } from './roster-source'
import { useRoster } from './use-roster'

export type PreviewsState = {
  ports: PreviewPort[]
  selectedId: string | undefined
  src: string | undefined
  select: (id: string) => void
  openUrl: (route: PreviewLinkRoute) => void
}

export const EMPTY_PREVIEWS: PreviewsState = {
  ports: [],
  selectedId: undefined,
  src: undefined,
  select: () => undefined,
  openUrl: () => undefined,
}

type Chosen = { id: string; src: string | undefined }

export function usePreviews(channel: RosterChannel | null): PreviewsState {
  const roster = useRoster(channel)
  const ports = useMemo(() => previewPortsOf(roster), [roster])
  const [chosen, setChosen] = useState<Chosen | undefined>(undefined)
  const selectedId = selectedPortOf({ ports, selectedId: chosen?.id })?.id
  const select = useCallback((id: string) => setChosen({ id, src: undefined }), [])
  const openUrl = useCallback(
    (route: PreviewLinkRoute) => setChosen({ id: route.portId, src: route.url }),
    [],
  )
  const src = chosen?.id === selectedId ? chosen?.src : undefined
  return { ports, selectedId, src, select, openUrl }
}
