import { decodeModelFavourites, encodeModelFavourites } from '@dltech/atlas-wire/web'
import { useState } from 'react'
import { z } from 'zod'

import { useSettings } from '../settings/settings-provider'

export type PinnedModels = {
  pinned: readonly string[]
  setPinned: (ids: string[]) => void
}

export const usePinnedModels = (): PinnedModels => {
  const settings = useSettings()
  const [local, setLocal] = useState<string[] | null>(null)
  const stored = decodeModelFavourites(
    settings.read({ key: 'model.favourites', schema: z.string() }),
  )

  return {
    pinned: local ?? stored,
    setPinned: (ids) => {
      setLocal(ids)
      settings.save({ 'model.favourites': encodeModelFavourites(ids) }).catch(() => setLocal(null))
    },
  }
}
