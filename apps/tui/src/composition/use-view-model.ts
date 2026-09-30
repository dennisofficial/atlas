import { parseRef, type ProviderIdentity, type ThreadId } from '@dltech/atlas-core'
import { storedModel, threadSelection, type ModelSelection } from '@dltech/atlas-harness'
import { useCallback, useEffect, useState } from 'react'

import { notify } from '../ui/notice-store'
import type { SwitcherChoice } from '../ui/switcher-model'
import type { AtlasApp } from './compose'

export type ViewModelControl = {
  selection: ModelSelection | null
  handlePicked: (args: { choice: SwitcherChoice }) => void
}

const noopPicked = (): void => undefined

export function useViewModel(args: {
  app: AtlasApp
  threadId: ThreadId
  model?: ProviderIdentity | undefined
  enabled: boolean
}): ViewModelControl {
  const { app, threadId, enabled } = args
  const [selection, setSelection] = useState<ModelSelection | null>(null)

  useEffect(() => {
    if (!enabled) return
    let dropped = false
    void app.threads.find({ threadId }).then((thread) => {
      if (dropped) return
      const stored = thread?.model
      const parsed = stored === undefined ? undefined : parseRef(stored.ref)
      if (stored !== undefined && parsed !== undefined) {
        setSelection(threadSelection({ stored, fallback: { ref: parsed, effort: app.model.choice().effort }, catalogue: app.models }))
        return
      }
      if (args.model !== undefined) {
        setSelection({ ref: { providerId: args.model.id, modelId: args.model.modelId }, effort: app.model.choice().effort })
        return
      }
      setSelection(app.model.choice())
    })
    return () => {
      dropped = true
    }
  }, [app, threadId, enabled, args.model])

  useEffect(() => {
    if (!enabled) return
    return app.threads.onModelChosen((chosen) => {
      if (chosen.threadId !== threadId) return
      setSelection(
        threadSelection({
          stored: chosen.model,
          fallback: app.model.choice(),
          catalogue: app.models,
        }),
      )
    })
  }, [app, threadId, enabled])

  const handlePicked = useCallback(
    ({ choice }: { choice: SwitcherChoice }) => {
      if (!enabled || choice.ref === null) return
      const prior = selection
      if (prior === null) return

      const next: ModelSelection = { ref: choice.ref, effort: choice.effort }
      setSelection(next)
      void app.threads.chooseModel({ threadId, model: storedModel(next), retarget: true }).catch((error: unknown) => {
        setSelection(prior)
        notify({ text: error instanceof Error ? error.message : 'the model switch was refused' })
      })
    },
    [app, threadId, enabled, selection],
  )

  if (!enabled) return { selection: null, handlePicked: noopPicked }
  return { selection, handlePicked }
}
