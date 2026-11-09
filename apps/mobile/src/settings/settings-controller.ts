import { decodeSettingValue, resolveCloudSetting, type SettingScalar } from '@dltech/atlas-wire/web'
import type { z } from 'zod'

import {
  applyChanges,
  encodedChanges,
  type SettingsChanges,
  type SettingsStorage,
  type SettingsValues,
} from './settings-store'

export type SettingsGateway = {
  list: () => Promise<{ settings: readonly { key: string; value: string }[] }>
  patch: (values: Record<string, string | null>) => Promise<void>
}

export type SettingsState = { values: SettingsValues; ready: boolean; failed: boolean }

export type SettingsController = {
  getState: () => SettingsState
  subscribe: (listener: () => void) => () => void
  read: <TValue extends SettingScalar>(args: { key: string; schema: z.ZodType<TValue> }) => TValue
  save: (changes: SettingsChanges) => Promise<void>
  load: () => Promise<void>
}

const EMPTY: SettingsState = { values: new Map(), ready: false, failed: false }

export const createSettingsController = (args: {
  gateway: () => SettingsGateway | undefined
  storage: SettingsStorage
}): SettingsController => {
  const { gateway, storage } = args
  let state: SettingsState = EMPTY
  const listeners = new Set<() => void>()
  let generation = 0

  const commit = (next: SettingsState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }

  const load = async (): Promise<void> => {
    const born = (generation += 1)
    const cached = await storage.load()
    if (born !== generation) return
    commit({ values: cached, ready: cached.size > 0, failed: false })
    const source = gateway()
    if (source === undefined) return
    try {
      const body = await source.list()
      if (born !== generation) return
      const fresh: SettingsValues = new Map(
        body.settings.map((setting) => [setting.key, decodeSettingValue(setting.value)]),
      )
      commit({ values: fresh, ready: true, failed: false })
      void storage.save(fresh)
    } catch {
      if (born !== generation) return
      const held = state.values.size > 0
      commit({ values: state.values, ready: held, failed: !held })
    }
  }

  const save = async (changes: SettingsChanges): Promise<void> => {
    const source = gateway()
    if (source === undefined) throw new Error('settings cannot be saved while signed out')
    const previous = state.values
    const next = applyChanges(previous, changes)
    commit({ ...state, values: next })
    void storage.save(next)
    try {
      await source.patch(encodedChanges(changes))
    } catch (error) {
      commit({ ...state, values: previous })
      void storage.save(previous)
      throw error
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    read: (input) => resolveCloudSetting({ values: state.values, ...input }),
    save,
    load,
  }
}
