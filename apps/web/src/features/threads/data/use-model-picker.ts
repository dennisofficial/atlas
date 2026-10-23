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

import { modelOptionsOf, type ModelOptions } from './model-options'

const PERSONAL = { kind: ESettingsTarget.Personal } as const

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
  const accounts = useCloudQuery({ key: 'personal-accounts', load: fetchAccounts })
  const settings = useCloudSettings(PERSONAL)
  const [localPinned, setLocalPinned] = useState<string[] | null>(null)
  const { save, read } = settings

  const options = useMemo(
    () =>
      modelOptionsOf({
        accounts: accounts.data ?? [],
        includeAuto: args.includeAuto,
        currentId: args.currentId,
      }),
    [accounts.data, args.includeAuto, args.currentId],
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
    ready: accounts.state !== EQueryState.Loading && settings.query.state !== EQueryState.Loading,
    options,
    personalId: read({ key: 'model.id', schema: z.string() }),
    personalEffort: read({ key: 'model.effort', schema: z.string() }),
    pinned,
    onPinnedChange: handlePinnedChange,
  }
}
