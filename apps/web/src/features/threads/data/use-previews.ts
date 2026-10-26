'use client'

import { useMemo, useState } from 'react'

import { selectedPortOf, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'

import { previewPortsOf } from './preview-ports'
import type { RosterChannel } from './roster-source'
import { useRoster } from './use-roster'

export function usePreviews(channel: RosterChannel | null): {
  ports: PreviewPort[]
  selectedId: string | undefined
  select: (id: string) => void
} {
  const roster = useRoster(channel)
  const ports = useMemo(() => previewPortsOf(roster), [roster])
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const selectedId = selectedPortOf({ ports, selectedId: chosen })?.id
  return { ports, selectedId, select: setChosen }
}
