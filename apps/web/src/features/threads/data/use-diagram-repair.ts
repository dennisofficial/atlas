'use client'

import { useMemo } from 'react'

import { ECapability, EConnectionView } from '@dltech/atlas-client/channel'

import { useThreadPanel } from '../panel/thread-panel-context'
import {
  DIAGRAM_REPAIR_NEEDS_SANDBOX,
  requestDiagramRepair,
  type RepairDiagramAction,
} from './diagram-repair'
import { useServeSupports } from './use-serve-supports'

export function useDiagramRepair(): RepairDiagramAction | null {
  const { threadId, channel } = useThreadPanel()
  const supported = useServeSupports({ channel, capability: ECapability.DiagramRepair })
  return useMemo(() => {
    if (channel === null || !supported) return null
    return async ({ messageId, chart, error }) => {
      if (channel.connection().state !== EConnectionView.Connected) {
        throw new Error(DIAGRAM_REPAIR_NEEDS_SANDBOX)
      }
      await requestDiagramRepair({
        request: (call) => channel.request(call),
        threadId,
        messageId,
        source: chart,
        error,
      })
    }
  }, [channel, supported, threadId])
}
