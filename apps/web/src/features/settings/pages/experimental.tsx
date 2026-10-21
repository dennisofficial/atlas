'use client'

import { useCallback, useState } from 'react'

import type { SettingValues } from '@/lib/cloud-settings'

import { EXPERIMENT_KEYS, experimentEnabled } from '../data/personal/interface-settings'
import { QueryPage } from '../data/personal/query-boundary'
import { usePersonalSettings } from '../data/personal/use-settings-draft'
import { useSaveAction } from '../data/personal/use-save-action'
import { EXPERIMENTS } from '../fixtures/settings-account'
import { AccountExperimentRow } from '../parts/account-experiment-row'
import { SettingsCard, SettingsPage } from '../settings-layout'

const TITLE = 'Experimental'
const DESCRIPTION = 'Try features that are still being shaped. They apply to new threads.'

export function ExperimentalPage() {
  const settings = usePersonalSettings()
  return (
    <QueryPage query={settings.query} title={TITLE} description={DESCRIPTION}>
      {(values) => <ExperimentalList values={values} save={settings.save} />}
    </QueryPage>
  )
}

function ExperimentalList({
  values,
  save,
}: {
  values: SettingValues
  save: (changes: Record<string, boolean>) => Promise<void>
}) {
  const { saving, run } = useSaveAction()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const handleToggle = useCallback(
    async (args: { id: string; next: boolean }) => {
      const key = EXPERIMENT_KEYS[args.id]
      if (key === undefined) return
      setPendingId(args.id)
      await run({ work: () => save({ [key]: args.next }) })
      setPendingId(null)
    },
    [run, save],
  )

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsCard>
        {EXPERIMENTS.map((experiment) => (
          <AccountExperimentRow
            key={experiment.id}
            experiment={experiment}
            enabled={experimentEnabled({ values, id: experiment.id })}
            disabled={saving && pendingId === experiment.id}
            onToggle={(next) => void handleToggle({ id: experiment.id, next })}
          />
        ))}
      </SettingsCard>
      <p className="text-xs text-muted-foreground">
        Experiments may change behavior or disappear between releases.
      </p>
    </SettingsPage>
  )
}
