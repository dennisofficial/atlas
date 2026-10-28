'use client'

import { useCallback } from 'react'
import {
  useCloudSettings,
  type CloudSettings,
  type SettingChanges,
  type SettingValues,
} from '@/lib/cloud-settings'
import { useSaveAction } from './use-save-action'
import { useDraft, type Draft } from '../../use-draft'

export function usePersonalSettings(): CloudSettings {
  return useCloudSettings()
}

export function useSettingsDraft<TValue>(args: {
  values: SettingValues
  fromValues: (values: SettingValues) => TValue
  toChanges: (args: { saved: TValue; draft: TValue }) => SettingChanges
  save: (changes: SettingChanges) => Promise<void>
}): { draft: Draft<TValue>; saving: boolean; handleSave: () => Promise<void> } {
  const saved = args.fromValues(args.values)
  const draft = useDraft(saved)
  const { saving, run } = useSaveAction()
  const { save, toChanges } = args
  const { value, save: commit } = draft
  const handleSave = useCallback(async () => {
    const done = await run({
      work: () => save(toChanges({ saved, draft: value })),
      success: 'Saved',
    })
    if (done) commit()
  }, [run, save, toChanges, saved, value, commit])
  return { draft, saving, handleSave }
}
