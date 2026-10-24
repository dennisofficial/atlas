import { useState } from 'react'
import { toast } from 'sonner'

import { changeThreadModel } from './change-thread-model'
import type { ThreadModelChoice } from './live-thread-view'
import { existingSelectionOf, UNSET_SELECTION, type ModelSelection } from './model-selection'
import { patchThreadModel } from './threads-api'
import { useModelPicker } from './use-model-picker'
import { messageOf } from './use-send'

export function useThreadModel(args: { threadId: string; stored: ThreadModelChoice | undefined }) {
  const [chosen, setChosen] = useState<ModelSelection | null>(null)
  const selection = chosen ?? existingSelectionOf(args.stored)
  const picker = useModelPicker({
    currentId: selection.id === UNSET_SELECTION.id ? undefined : selection.id,
  })

  const handleRemoteChange = (model: ThreadModelChoice) => setChosen(existingSelectionOf(model))

  const handleChange = async (args2: {
    next: ModelSelection
    chooseLive: (model: ThreadModelChoice) => Promise<boolean>
  }) => {
    const previous = selection
    setChosen(args2.next)
    try {
      await changeThreadModel({
        threadId: args.threadId,
        model: { ref: args2.next.id, effort: args2.next.effort },
        chooseLive: args2.chooseLive,
        patch: patchThreadModel,
      })
    } catch (failure) {
      toast.error(messageOf(failure))
      setChosen(previous)
    }
  }

  return { picker, selection, handleRemoteChange, handleChange }
}
