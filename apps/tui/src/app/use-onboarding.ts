import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import type { SettingsResolution } from '@dltech/atlas-core'

import type { ProviderRow } from '../ui/accounts-model'
import {
  EOnboardingRow,
  modelRowOf,
  onboardingRowsOf,
  type OnboardingRowView,
} from './onboarding-rows'

export type OnboardingControl = {
  visible: boolean
  rows: readonly OnboardingRowView[]
  rowIndex: number
  handleActivate: (row: OnboardingRowView) => void
  handleKey: (key: KeyEvent) => boolean
  handleDismiss: () => void
}

export function useOnboarding(args: {
  due: boolean
  rows: readonly ProviderRow[]
  resolution: SettingsResolution
  onOpenAccounts: () => void
  onChooseModel: (id: string) => void
}): OnboardingControl {
  const [dismissed, setDismissed] = useState(false)
  const [rowIndex, setRowIndex] = useState(0)

  const rows = useMemo(
    () => onboardingRowsOf({ rows: args.rows, resolution: args.resolution }),
    [args.resolution, args.rows],
  )

  const visible = args.due && !dismissed

  const handleDismiss = useCallback(() => setDismissed(true), [])

  const handleActivate = useCallback(
    (row: OnboardingRowView) => {
      if (row.key === EOnboardingRow.Accounts) {
        args.onOpenAccounts()
        return
      }
      if (row.key === EOnboardingRow.Begin) {
        if (row.done) setDismissed(true)
        return
      }
      const modelRow = modelRowOf(row.key)
      if (modelRow !== undefined) args.onChooseModel(modelRow.id)
    },
    [args],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (!visible) return false

      if (key.name === 'escape') {
        setDismissed(true)
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        setRowIndex((current) =>
          Math.min(Math.max(0, current + (key.name === 'up' ? -1 : 1)), rows.length - 1),
        )
        return true
      }

      if (key.name === 'return' || key.name === 'enter') {
        const row = rows[rowIndex]
        if (row !== undefined) handleActivate(row)
        return true
      }

      return false
    },
    [handleActivate, rows, rowIndex, visible],
  )

  return { visible, rows, rowIndex, handleActivate, handleKey, handleDismiss }
}
