'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { messageOf } from '@/features/threads/data/use-send'
import { createFieldsOf, type ModelSelection } from '@/features/threads/data/model-selection'
import { useModelPicker, type ModelPicker } from '@/features/threads/data/use-model-picker'

import { sessionSelectionOf, type SessionModelChoice } from './session-model'
import { sessionsApi } from './sessions-api'

export const MODEL_SET_COMMAND = 'model-set'

export type SessionModelChoiceView = {
  picker: ModelPicker
  selection: ModelSelection
  onSelectionChange: (selection: ModelSelection) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  setOpen: (open: boolean) => void
}

export function useSessionModelChoice(args: {
  sessionId: string
  current: SessionModelChoice | null | undefined
}): SessionModelChoiceView {
  const { sessionId, current } = args
  const picker = useModelPicker({ currentId: current?.ref })
  const [chosen, setChosen] = useState<ModelSelection | null>(null)
  const [open, setOpen] = useState(false)

  const handleSelectionChange = useCallback(
    (selection: ModelSelection) => {
      setChosen(selection)
      sessionsApi
        .command({ sessionId, name: MODEL_SET_COMMAND, args: createFieldsOf(selection) })
        .catch((failure: unknown) => {
          setChosen(null)
          toast.error(messageOf(failure))
        })
    },
    [sessionId],
  )

  return {
    picker,
    selection: chosen ?? sessionSelectionOf(current),
    onSelectionChange: handleSelectionChange,
    open,
    onOpenChange: setOpen,
    setOpen,
  }
}
