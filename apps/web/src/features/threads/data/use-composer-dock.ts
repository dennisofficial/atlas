import { useMemo } from 'react'
import { toast } from 'sonner'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { planStepsOf } from './composer-plan'
import { QUEUE_PLACEHOLDER, queuedOf, takeBackableIdOf, TOO_LATE_NOTICE } from './composer-queue'
import { contextUsageOf } from './context-usage'
import { eventsFromWire } from './events-from-wire'
import type { ThreadSource } from './thread-source'
import type { ModelSelection } from './model-selection'
import type { ModelPicker } from './use-model-picker'
import { messageOf } from './use-send'

export function useComposerDock(args: {
  visible: WireEvent[]
  source: Pick<ThreadSource, 'pending' | 'reported' | 'working' | 'takeBackPending'>
  picker: ModelPicker
  selection: ModelSelection
  onRestore: (text: string) => void
}) {
  const { visible, source, picker, selection, onRestore } = args
  const events = useMemo(() => eventsFromWire(visible), [visible])
  const steps = useMemo(() => planStepsOf(events), [events])
  const queued = useMemo(() => queuedOf(source.pending), [source.pending])
  const usage = useMemo(
    () =>
      contextUsageOf({
        reported: source.reported,
        events,
        selectedId: selection.id,
        models: picker.options.models,
      }),
    [source.reported, events, selection.id, picker.options.models],
  )

  const handleRemoveQueued = async (id: string) => {
    if (takeBackableIdOf(source.pending) !== id) return
    try {
      const text = await source.takeBackPending()
      if (text === null) toast(TOO_LATE_NOTICE)
      else onRestore(text)
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  return {
    steps,
    queued,
    usage,
    placeholder: source.working ? QUEUE_PLACEHOLDER : undefined,
    handleRemoveQueued,
  }
}
