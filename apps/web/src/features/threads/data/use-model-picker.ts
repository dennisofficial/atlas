import { useCallback, useMemo, useState } from 'react'
import { z } from 'zod'

import { decodeModelFavourites, encodeModelFavourites } from '@dltech/atlas-wire/web'

import { fetchAccounts } from '@/features/settings/data/personal/accounts-api'
import { useCloudSettings } from '@/lib/cloud-settings'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { modelOptionsOfSource, type ModelOptions } from './model-options'
import { fetchModels, loadModelsSource } from './models-api'

const loadSource = () => loadModelsSource({ loadModels: fetchModels, loadAccounts: fetchAccounts })

export type ModelPicker = {
  ready: boolean
  options: ModelOptions
  personalId: string
  personalEffort: string
  pinned: string[]
  onPinnedChange: (ids: string[]) => void
}

export function useModelPicker(args: { currentId?: string | undefined } = {}): ModelPicker {
  const source = useCloudQuery({
    key: 'model-picker-source',
    load: loadSource,
  })
  const settings = useCloudSettings()
  const [localPinned, setLocalPinned] = useState<string[] | null>(null)
  const { save, read } = settings

  const options = useMemo(
    () =>
      modelOptionsOfSource({
        source: source.data,
        currentId: args.currentId,
      }),
    [source.data, args.currentId],
  )

  const stored = decodeModelFavourites(read({ key: 'model.favourites', schema: z.string() }))
  const pinned = localPinned ?? stored

  const handlePinnedChange = useCallback(
    (ids: string[]) => {
      setLocalPinned(ids)
      save({ 'model.favourites': encodeModelFavourites(ids) }).catch(() => setLocalPinned(null))
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
