import { useCallback, useMemo, useState } from 'react'
import { z } from 'zod'

import {
  encodePinnedModels,
  parsePinnedModels,
  PINNED_MODELS_FALLBACK,
} from '@dltech/atlas-wire/web'

import { fetchAccounts } from '@/features/settings/data/personal/accounts-api'
import { ESettingsTarget, useCloudSettings } from '@/lib/cloud-settings'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { modelOptionsOfSource, type ModelOptions } from './model-options'
import { fetchModels, loadModelsSource } from './models-api'

const PERSONAL = { kind: ESettingsTarget.Personal } as const

const loadSource = () => loadModelsSource({ loadModels: fetchModels, loadAccounts: fetchAccounts })

export type ModelPicker = {
  ready: boolean
  options: ModelOptions
  personalId: string
  personalEffort: string
  pinned: string[]
  onPinnedChange: (ids: string[]) => void
}

export function useModelPicker(args: {
  includeAuto: boolean
  currentId?: string | undefined
}): ModelPicker {
  const source = useCloudQuery({ key: 'model-picker-source', load: loadSource })
  const settings = useCloudSettings(PERSONAL)
  const [localPinned, setLocalPinned] = useState<string[] | null>(null)
  const { save, read } = settings

  const options = useMemo(
    () =>
      modelOptionsOfSource({
        source: source.data,
        includeAuto: args.includeAuto,
        currentId: args.currentId,
      }),
    [source.data, args.includeAuto, args.currentId],
  )

  const stored = parsePinnedModels(
    read({ key: 'web.models.pinned', schema: z.string() }) || PINNED_MODELS_FALLBACK,
  )
  const pinned = localPinned ?? stored

  const handlePinnedChange = useCallback(
    (ids: string[]) => {
      setLocalPinned(ids)
      save({ 'web.models.pinned': encodePinnedModels(ids) }).catch(() => setLocalPinned(null))
    },
    [save],
  )

  return {
    ready: source.state !== EQueryState.Loading && settings.query.state !== EQueryState.Loading,
    options,
    personalId: read({ key: 'model.id', schema: z.string() }),
    personalEffort: read({ key: 'model.effort', schema: z.string() }),
    pinned,
    onPinnedChange: handlePinnedChange,
  }
}
