import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { ESettingId, refKey, textValueOf } from '@dltech/atlas-core'
import { suggestedModelRef } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'

export enum EOnboardingRow {
  Accounts = 'accounts',
  Default = 'default',
  Quick = 'quick',
  Compaction = 'compaction',
  Subagents = 'subagents',
  Begin = 'begin',
}

export type OnboardingRowView = {
  key: EOnboardingRow
  label: string
  value: string
  done: boolean
}

export type OnboardingState = { rowIndex: number }

export type OnboardingControl = {
  state: OnboardingState | null
  rows: readonly OnboardingRowView[]
  ready: boolean
  handleKey: (key: KeyEvent) => void
  handleActivate: (row: OnboardingRowView) => void
  handleDismiss: () => void
}

const MODEL_ROWS: readonly { key: EOnboardingRow; id: ESettingId; label: string }[] = [
  { key: EOnboardingRow.Default, id: ESettingId.ModelId, label: 'Default model' },
  { key: EOnboardingRow.Quick, id: ESettingId.QuickModel, label: 'Quick calls' },
  { key: EOnboardingRow.Compaction, id: ESettingId.CompactionModel, label: 'Compaction' },
  { key: EOnboardingRow.Subagents, id: ESettingId.SubagentModel, label: 'Sub-agents' },
]

/**
 * A first launch has no settings file and possibly no accounts, and neither the old hardcoded
 * fallbacks nor a guessed provider can carry it: the picks have to be made. The gate is the empty
 * user document or a catalogue with nothing reachable, so an established install never sees this.
 * Escape dismisses for the session; a still-fresh install is asked again on the next launch.
 */
export function useOnboarding(args: {
  app: AtlasApp
  onChooseModel: (id: string) => void
  onOpenAccounts: () => void
}): OnboardingControl {
  const { app } = args
  const settingsVersion = useSyncExternalStore(app.settings.subscribe, app.settings.version)
  const accountsVersion = useSyncExternalStore(app.models.subscribe, app.models.version)

  const [state, setState] = useState<OnboardingState | null>(() => {
    const fresh = Object.keys(app.settings.snapshot().document.values).length === 0
    const reachable = app.models.providers.some((provider) => app.models.reachable(provider.id))
    return fresh || !reachable ? { rowIndex: 0 } : null
  })

  const rows = useMemo((): readonly OnboardingRowView[] => {
    const resolution = app.settings.snapshot().resolution
    const connected = app.models.providers.filter((provider) =>
      app.models.reachable(provider.id),
    ).length

    const accountRow: OnboardingRowView = {
      key: EOnboardingRow.Accounts,
      label: 'Provider accounts',
      value:
        connected === 0
          ? 'none yet — connect one'
          : `${connected} connected`,
      done: connected > 0,
    }

    const modelRows = MODEL_ROWS.map((row): OnboardingRowView => {
      const held = textValueOf({ resolution, id: row.id })
      const suggested = refKey(suggestedModelRef({ id: row.id, settled: resolution, catalogue: app.models }))
      return {
        key: row.key,
        label: row.label,
        value: held.length > 0 ? held : `suggested: ${suggested}`,
        done: held.length > 0,
      }
    })

    const ready = accountRow.done && modelRows.every((row) => row.done)

    return [
      accountRow,
      ...modelRows,
      {
        key: EOnboardingRow.Begin,
        label: 'Begin',
        value: ready ? 'start atlas' : 'pick the four models above first',
        done: ready,
      },
    ]
  }, [app, settingsVersion, accountsVersion])

  const ready = rows.at(-1)?.done ?? false

  const handleDismiss = useCallback(() => setState(null), [])

  const handleActivate = useCallback(
    (row: OnboardingRowView) => {
      if (row.key === EOnboardingRow.Accounts) {
        args.onOpenAccounts()
        return
      }
      if (row.key === EOnboardingRow.Begin) {
        if (row.done) setState(null)
        return
      }

      const modelRow = MODEL_ROWS.find((one) => one.key === row.key)
      if (modelRow !== undefined) args.onChooseModel(modelRow.id)
    },
    [args],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return
      key.preventDefault()

      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        const delta = key.name === 'up' ? -1 : 1
        const rowIndex = Math.min(Math.max(0, state.rowIndex + delta), rows.length - 1)
        setState({ rowIndex })
        return
      }

      if (key.name === 'return') {
        const row = rows[state.rowIndex]
        if (row !== undefined) handleActivate(row)
      }
    },
    [handleActivate, handleDismiss, rows, state],
  )

  return useMemo(
    () => ({ state, rows, ready, handleKey, handleActivate, handleDismiss }),
    [state, rows, ready, handleKey, handleActivate, handleDismiss],
  )
}
