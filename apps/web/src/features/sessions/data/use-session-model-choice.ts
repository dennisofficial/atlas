'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { messageOf } from '@/features/threads/data/use-send'
import { useAccounts } from '@/features/threads/data/use-account-label'
import type { ModelSelection } from '@/features/threads/data/model-selection'
import { useModelPicker, type ModelPicker } from '@/features/threads/data/use-model-picker'

import { sessionsApi } from './sessions-api'
import {
  accountModelOptionsOf,
  modelSetArgsOf,
  selectionOfChoice,
  type SessionModelChoice,
} from './session-model'

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
  const accounts = useAccounts()
  const picker = useModelPicker({ currentId: current?.ref })
  const [chosen, setChosen] = useState<ModelSelection | null>(null)
  const [open, setOpen] = useState(false)

  const models = useMemo(
    () => accountModelOptionsOf({ models: picker.options.models, accounts, current }),
    [picker.options.models, accounts, current],
  )

  const handleSelectionChange = useCallback(
    (selection: ModelSelection) => {
      setChosen(selection)
      sessionsApi
        .command({ sessionId, name: MODEL_SET_COMMAND, args: modelSetArgsOf(selection) })
        .catch((failure: unknown) => {
          setChosen(null)
          toast.error(messageOf(failure))
        })
    },
    [sessionId],
  )

  return {
    picker: {
      ...picker,
      options: { models, reconnectProviders: picker.options.reconnectProviders },
    },
    selection: chosen ?? selectionOfChoice(current),
    onSelectionChange: handleSelectionChange,
    open,
    onOpenChange: setOpen,
    setOpen,
  }
}
