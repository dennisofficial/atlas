import { parseRef, type ProviderIdentity, type ThreadId } from '@dltech/atlas-core'
import { storedModel, threadSelection, type ModelSelection } from '@dltech/atlas-harness'
import { useCallback, useEffect, useRef, useState } from 'react'

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

  /**
   * A pick sets the selection optimistically, then writes it. The roster republishes a child's
   * snapshot on every step, and `args.model` arrives as a fresh object each time — so keying the
   * re-read on that identity would re-run mid-pick and clobber the optimistic value with the model
   * still stored. The pending ref holds the pick until its write resolves, and the re-read keys on
   * the model's value, not its identity.
   */
  const pendingPick = useRef<ModelSelection | null>(null)
  const observedModel =
    args.model === undefined ? undefined : `${args.model.id}:${args.model.modelId}`

  useEffect(() => {
    if (!enabled) return
    if (pendingPick.current !== null) return
    let dropped = false
    void app.threads.find({ threadId }).then((thread) => {
      if (dropped) return
      if (pendingPick.current !== null) return
      const stored = thread?.model
      const parsed = stored === undefined ? undefined : parseRef(stored.ref)
      if (stored !== undefined && parsed !== undefined) {
        setSelection(threadSelection({ stored, fallback: { ref: parsed, effort: app.model.choice().effort }, catalogue: app.models }))
        return
      }
      if (observedModel !== undefined) {
        const [providerId, modelId] = observedModel.split(':')
        if (providerId !== undefined && modelId !== undefined) {
          setSelection({ ref: { providerId, modelId }, effort: app.model.choice().effort })
          return
        }
      }
      setSelection(app.model.choice())
    })
    return () => {
      dropped = true
    }
  }, [app, threadId, enabled, observedModel])

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
      pendingPick.current = next
      setSelection(next)
      void app.threads.chooseModel({ threadId, model: storedModel(next), retarget: true })
        .catch((error: unknown) => {
          setSelection(prior)
          notify({ text: error instanceof Error ? error.message : 'the model switch was refused' })
        })
        .finally(() => {
          pendingPick.current = null
        })
    },
    [app, threadId, enabled, selection],
  )

  if (!enabled) return { selection: null, handlePicked: noopPicked }
  return { selection, handlePicked }
}
