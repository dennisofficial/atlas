import { useMemo } from 'react'
import { toast } from 'sonner'

import type { QueuedMessageSave } from '@dltech/atlas-ui/ai/queued-messages'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { QUEUE_PLACEHOLDER, queuedOf, takeBackableIdOf, TOO_LATE_NOTICE } from './composer-queue'
import { contextUsageOf } from './context-usage'
import { eventsFromWire } from './events-from-wire'
import { removeQueuedEntry, saveQueuedEntry } from './queued-edit'
import type { TakenBack } from './live-thread-view'
import type { ThreadSource } from './thread-source'
import type { ModelSelection } from './model-selection'
import type { ModelPicker } from './use-model-picker'
import { messageOf } from './use-send'

export function useComposerDock(args: {
  threadId: string
  visible: WireEvent[]
  source: Pick<ThreadSource, 'pending' | 'reported' | 'working' | 'channel' | 'takeBackPending'>
  picker: ModelPicker
  selection: ModelSelection
  onRestore: (restored: TakenBack) => void
}) {
  const { threadId, visible, source, picker, selection, onRestore } = args
  const { channel } = source
  const events = useMemo(() => eventsFromWire(visible), [visible])
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

  const handleSaveQueued = async ({ id, text }: QueuedMessageSave) => {
    try {
      const notice = await saveQueuedEntry({ channel, threadId, id, text })
      if (notice !== null) toast(notice)
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  const handleTakeBack = async () => {
    try {
      const taken = await source.takeBackPending()
      if (taken === null) toast(TOO_LATE_NOTICE)
      else onRestore(taken)
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  const handleRemoveQueued = async (id: string) => {
    if (channel === null) {
      if (takeBackableIdOf(source.pending) === id) await handleTakeBack()
      return
    }
    try {
      const notice = await removeQueuedEntry({ channel, threadId, id })
      if (notice !== null) toast(notice)
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  return {
    queued,
    usage,
    placeholder: source.working ? QUEUE_PLACEHOLDER : undefined,
    handleSaveQueued,
    handleRemoveQueued,
  }
}
