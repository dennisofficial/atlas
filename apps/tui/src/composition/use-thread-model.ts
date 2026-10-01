import { refKey, type ThreadId } from '@dltech/atlas-core'
import type { ThreadModel } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { notify } from '../ui/notice-store'
import type { SwitcherChoice, SwitcherTarget } from '../ui/switcher-model'
import { EModelScope } from '../ui/switcher-model'
import {
  cloudModelFailureNotice,
  modelPersistFailureNotice,
} from './cloud/cloud-write-notices'
import type { AtlasApp } from './compose'
import type { ModelSelection } from '@dltech/atlas-harness'
import {
  defaultSelection,
  rememberSettingModel,
  storedModel,
  threadSelection,
} from '@dltech/atlas-harness'

export type ThreadModelControl = {
  selection: ModelSelection
  fallback: ModelSelection
  handlePicked: (args: { choice: SwitcherChoice; target: SwitcherTarget }) => void
}

/**
 * Two preferences, one picker. A conversation carries the model it was last switched to, so two
 * terminals on two threads stop fighting over one remembered pair; the settings row carries what a
 * conversation with nothing of its own begins on.
 *
 * The default is followed only while the thread has no model of its own — never started, never
 * switched on screen — so a default picked after adoption (onboarding's) still reaches the first
 * conversation instead of leaving it on the launch fallback. Once the thread has started or been
 * switched, raising the default reaches the next conversation instead of the one on screen. The
 * order of the effects is the other invariant: the thread's pair reaches the harness before
 * anything is written back, so the write sees the model this thread is on rather than the one the
 * thread before it left behind.
 */
export function useThreadModel(args: {
  app: AtlasApp
  /** The store the model write crosses — the cloud attachment's when the thread is lifted. */
  threads?: AtlasApp['threads'] | undefined
  /** True when the thread is cloud-lifted: the remote store is the live truth, so a refused write reverts the pick. */
  lifted?: boolean | undefined
  threadId: ThreadId
  stored: ThreadModel | undefined
  started: boolean
}): ThreadModelControl {
  const { app, threadId, stored, started } = args
  const lifted = args.lifted ?? false
  const threads = args.threads ?? app.threads
  const [selection, setSelection] = useState<ModelSelection>(() => app.model.choice())
  const launching = useRef(true)
  const adoptedFor = useRef<ThreadId | null>(null)
  const switchedFor = useRef<ThreadId | null>(null)
  const wasStarted = useRef(started)

  useSyncExternalStore(app.settings.subscribe, app.settings.version)
  const { resolution } = app.settings.snapshot()

  const fallback = useMemo(
    () => defaultSelection({ settled: resolution, catalogue: app.models }),
    [app.models, resolution],
  )

  useEffect(() => {
    const pinned = launching.current && app.modelPinned
    const adoption = adoptedFor.current !== threadId
    launching.current = false
    adoptedFor.current = threadId
    if (pinned) return
    if (!adoption && stored === undefined && (started || switchedFor.current === threadId)) return

    app.model.select(
      threadSelection({
        stored,
        fallback: defaultSelection({
          settled: app.settings.snapshot().resolution,
          catalogue: app.models,
        }),
        catalogue: app.models,
      }),
    )
    setSelection(app.model.choice())
  }, [app, stored, started, threadId, resolution])

  useEffect(() => {
    return threads.onModelChosen((chosen) => {
      if (chosen.threadId !== threadId) return
      if (app.modelPinned) return

      app.model.select(
        threadSelection({
          stored: chosen.model,
          fallback: defaultSelection({
            settled: app.settings.snapshot().resolution,
            catalogue: app.models,
          }),
          catalogue: app.models,
        }),
      )
      setSelection(app.model.choice())
      switchedFor.current = threadId
    })
  }, [app, threads, threadId])

  useEffect(() => {
    const opening = !wasStarted.current && started
    wasStarted.current = started
    if (!opening) return

    void threads
      .chooseModel({ threadId, model: storedModel(app.model.choice()) })
      .catch(() =>
        notify(
          lifted
            ? cloudModelFailureNotice()
            : modelPersistFailureNotice({ model: refKey(app.model.choice().ref) }),
        ),
      )
  }, [app, threads, lifted, started, threadId])

  const handlePicked = useCallback(
    ({ choice, target }: { choice: SwitcherChoice; target: SwitcherTarget }) => {
      if (choice.ref === null) return

      const next: ModelSelection = { ref: choice.ref, effort: choice.effort }

      if (target.scope === EModelScope.Setting) {
        rememberSettingModel({ settings: app.settings, target, selection: next })
        return
      }

      const prior = app.model.choice()
      app.model.select(next)
      const landed = app.model.choice()
      setSelection(landed)
      switchedFor.current = threadId
      if (refKey(landed.ref) !== refKey(next.ref)) return

      if (!started) return

      void threads.chooseModel({ threadId, model: storedModel(landed) }).catch(() => {
        if (lifted) {
          app.model.select(prior)
          setSelection(prior)
          notify(cloudModelFailureNotice())
          return
        }
        notify(
          modelPersistFailureNotice({
            model: refKey(prior.ref),
          }),
        )
      })
    },
    [app, threads, lifted, started, threadId],
  )

  return { selection, fallback, handlePicked }
}
