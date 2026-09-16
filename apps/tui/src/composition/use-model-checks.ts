import { useEffect, useRef, useSyncExternalStore } from 'react'

import { modelSettingProblemText, unreachableModelSettings } from '@dltech/atlas-harness'

import { clearNotice, ENoticeTone, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'

const keyFor = (id: string): string => `model-setting:${id}`

/**
 * A model row whose pick cannot run — the provider lost its account, or the model left the
 * catalogue — gets a standing notice naming the row, which clears itself the moment the row is
 * fixed. Pure config checks only; nothing is called.
 */
export function useModelChecks(app: AtlasApp): void {
  const settingsVersion = useSyncExternalStore(app.settings.subscribe, app.settings.version)
  const accountsVersion = useSyncExternalStore(app.models.subscribe, app.models.version)
  const posted = useRef(new Set<string>())

  useEffect(() => {
    const problems = unreachableModelSettings({
      definitions: app.settings.definitions,
      resolution: app.settings.snapshot().resolution,
      catalogue: app.models,
    })
    const live = new Set(problems.map((problem) => keyFor(problem.id)))

    for (const key of posted.current) {
      if (live.has(key)) continue
      clearNotice({ key })
      posted.current.delete(key)
    }

    for (const problem of problems) {
      notify({
        key: keyFor(problem.id),
        tone: ENoticeTone.Warn,
        sticky: true,
        text: modelSettingProblemText(problem),
      })
      posted.current.add(keyFor(problem.id))
    }
  }, [app, settingsVersion, accountsVersion])
}
