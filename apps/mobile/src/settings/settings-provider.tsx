import type { SettingScalar } from '@dltech/atlas-wire/web'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { z } from 'zod'

import { useAuth } from '../auth/auth-provider'
import { createSettingsController, type SettingsController } from './settings-controller'
import type { SettingsChanges } from './settings-store'
import { settingsStorage } from './settings-storage'

export type Settings = {
  ready: boolean
  failed: boolean
  read: <TValue extends SettingScalar>(args: { key: string; schema: z.ZodType<TValue> }) => TValue
  save: (changes: SettingsChanges) => Promise<void>
  reload: () => void
}

const SettingsContext = createContext<Settings | undefined>(undefined)

export const SettingsProvider = ({
  children,
  controller,
}: {
  children: ReactNode
  controller?: SettingsController | undefined
}) => {
  const { api } = useAuth()
  const current = useRef(api)
  current.current = api
  const held = useRef<SettingsController | undefined>(undefined)
  held.current ??=
    controller ??
    createSettingsController({
      gateway: () => {
        const client = current.current
        if (client === undefined) return undefined
        return {
          list: () => client.settings.list.query(),
          patch: (values) => client.settings.patch.mutate({ values }),
        }
      },
      storage: settingsStorage(),
    })
  const store = held.current

  useEffect(() => {
    void store.load()
  }, [store, api])

  const state = useSyncExternalStore(store.subscribe, store.getState)

  const save = useCallback((changes: SettingsChanges) => store.save(changes), [store])
  const reload = useCallback(() => void store.load(), [store])

  const value = useMemo<Settings>(
    () => ({ ready: state.ready, failed: state.failed, read: store.read, save, reload }),
    [state.ready, state.failed, store, save, reload],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = (): Settings => {
  const value = useContext(SettingsContext)
  if (value === undefined) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}
