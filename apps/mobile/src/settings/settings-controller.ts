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

type Pending = { at: number; generation: number }

const EMPTY: SettingsState = { values: new Map(), ready: false, failed: false }

export const createSettingsController = (args: {
  gateway: () => SettingsGateway | undefined
  storage: SettingsStorage
}): SettingsController => {
  const { gateway, storage } = args
  let state: SettingsState = EMPTY
  const listeners = new Set<() => void>()
  const written = new Map<string, number>()
  const pending = new Map<string, Pending>()
  let generation = 0
  let mutation = 0

  const commit = (next: SettingsState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }

  const keepLocal = (
    fresh: SettingsValues,
    args: { since: number; born: number },
  ): SettingsValues => {
    const merged = new Map(fresh)
    const keep = (key: string): void => {
      const value = state.values.get(key)
      if (value === undefined) merged.delete(key)
      else merged.set(key, value)
    }
    for (const [key, at] of written) if (at > args.since) keep(key)
    for (const [key, entry] of pending) if (entry.generation === args.born) keep(key)
    return merged
  }

  const load = async (): Promise<void> => {
    const born = (generation += 1)
    written.clear()
    const cached = await storage.load()
    if (born !== generation) return
    commit({ values: cached, ready: cached.size > 0, failed: false })
    const source = gateway()
    if (source === undefined) return
    const since = mutation
    try {
      const body = await source.list()
      if (born !== generation) return
      const fresh: SettingsValues = new Map(
        body.settings.map((setting) => [setting.key, decodeSettingValue(setting.value)]),
      )
      const merged = keepLocal(fresh, { since, born })
      commit({ values: merged, ready: true, failed: false })
      void storage.save(merged)
    } catch {
      if (born !== generation) return
      const held = state.values.size > 0
      commit({ values: state.values, ready: held, failed: !held })
    }
  }

  const restore = (held: ReadonlyMap<string, SettingScalar | undefined>, at: number): void => {
    const values = new Map(state.values)
    for (const [key, value] of held) {
      if (written.get(key) !== at) continue
      if (value === undefined) values.delete(key)
      else values.set(key, value)
    }
    commit({ ...state, values })
    void storage.save(values)
  }

  const save = async (changes: SettingsChanges): Promise<void> => {
    const source = gateway()
    if (source === undefined) throw new Error('settings cannot be saved while signed out')
    const born = generation
    const at = (mutation += 1)
    const held = new Map(Object.keys(changes).map((key) => [key, state.values.get(key)] as const))
    for (const key of held.keys()) {
      written.set(key, at)
      pending.set(key, { at, generation: born })
    }
    const next = applyChanges(state.values, changes)
    commit({ ...state, values: next })
    void storage.save(next)
    try {
      await source.patch(encodedChanges(changes))
    } catch (error) {
      if (born === generation) restore(held, at)
      throw error
    } finally {
      for (const key of held.keys()) if (pending.get(key)?.at === at) pending.delete(key)
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
