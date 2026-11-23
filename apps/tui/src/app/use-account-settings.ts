import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SettingDefinition, SettingValue, SettingsResolution } from '@dltech/atlas-core'

import type { SessionApi } from './session-api'
import {
  cloudValuesOf,
  decodedValuesOf,
  preferencesOf,
  resolutionOf,
  seedValuesOf,
  writeOf,
} from './settings-values'

export type AccountSettings = {
  resolution: SettingsResolution
  ready: boolean
  problem: string | undefined
  reload: () => void
  set: (args: { definition: SettingDefinition; value: SettingValue }) => Promise<boolean>
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useAccountSettings(args: {
  api: SessionApi | null
  preferences: Record<string, unknown>
  definitions: readonly SettingDefinition[]
  onLoaded: (preferences: Record<string, SettingValue>) => void
  onProblem: (reason: string) => void
}): AccountSettings {
  const { api, definitions } = args
  const [values, setValues] = useState<ReadonlyMap<string, SettingValue>>(() =>
    seedValuesOf({ preferences: args.preferences }),
  )
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [reads, setReads] = useState(0)

  const valuesRef = useRef(values)
  valuesRef.current = values
  const loaded = useRef(args.onLoaded)
  loaded.current = args.onLoaded
  const problemReport = useRef(args.onProblem)
  problemReport.current = args.onProblem

  useEffect(() => {
    if (api === null) return undefined

    let cancelled = false
    void api.listSettings().then(
      (rows) => {
        if (cancelled) return
        const decoded = decodedValuesOf(cloudValuesOf({ settings: rows }))
        valuesRef.current = decoded
        setValues(decoded)
        setReady(true)
        setProblem(undefined)
        loaded.current(preferencesOf(decoded))
      },
      (failure) => {
        if (cancelled) return
        setProblem(`could not load your settings — ${messageOf(failure)}`)
      },
    )

    return () => {
      cancelled = true
    }
  }, [api, reads])

  const reload = useCallback(() => setReads((read) => read + 1), [])

  const save = useCallback(
    async (write: { definition: SettingDefinition; value: SettingValue }): Promise<boolean> => {
      if (api === null) return false

      const written = writeOf({ definition: write.definition, value: write.value })
      try {
        if (written === 'remove') await api.removeSetting({ key: write.definition.id })
        else await api.setSetting(written)
      } catch (failure) {
        const reason = `could not save ${write.definition.label} — ${messageOf(failure)}`
        setProblem(reason)
        problemReport.current(reason)
        return false
      }

      setProblem(undefined)

      const next = new Map(valuesRef.current)
      if (written === 'remove') next.delete(write.definition.id)
      else next.set(write.definition.id, write.value)
      valuesRef.current = next
      setValues(next)
      loaded.current(preferencesOf(next))
      return true
    },
    [api],
  )

  const resolution = useMemo(() => resolutionOf({ definitions, values }), [definitions, values])

  return useMemo(
    () => ({
      resolution,
      ready,
      problem,
      reload,
      set: save,
    }),
    [problem, ready, reload, resolution, save],
  )
}
