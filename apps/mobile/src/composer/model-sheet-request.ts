import { router } from 'expo-router'
import { useSyncExternalStore } from 'react'

import type { IModelOption, IModelSelection } from './model-options'

export type TModelSheetRequest = {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  personalId: string
  defaultRow: boolean
  onSelect: (selection: IModelSelection | null) => void
}

const listeners = new Set<() => void>()
let current: TModelSheetRequest | null = null

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshotOf = (): TModelSheetRequest | null => current

export const presentModelSheet = (request: TModelSheetRequest): void => {
  current = request
  for (const listener of listeners) listener()
  router.push('/model')
}

export const useModelSheetRequest = (): TModelSheetRequest | null =>
  useSyncExternalStore(subscribe, snapshotOf, snapshotOf)
