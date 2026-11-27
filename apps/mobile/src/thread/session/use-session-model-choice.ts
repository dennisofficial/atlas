import type { ApiClient } from '@dltech/atlas-api-router'
import { useState } from 'react'

import { type IModelOption, type IModelSelection } from '../../composer/model-options'
import { useModels } from '../../composer/use-models'
import { choiceOfSessionRows, modelSetArgsOf, selectionOfSessionRows } from './session-commands'
import { useSessionRows } from './use-session-rows'

export type SessionModelChoice = {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinnedRef: string | null
  onSelect: (selection: IModelSelection) => void
}

export const useSessionModelChoice = (args: {
  api: ApiClient | undefined
  sessionId: string
}): SessionModelChoice => {
  const { models } = useModels()
  const rows = useSessionRows()
  const [chosen, setChosen] = useState<IModelSelection | undefined>(undefined)
  const pinnedRef = choiceOfSessionRows(rows ?? [], args.sessionId)?.ref ?? null

  const handleSelect = (selection: IModelSelection) => {
    setChosen(selection)
    if (args.api === undefined) return
    void args.api.sessions.command
      .mutate({ sessionId: args.sessionId, name: 'model-set', args: modelSetArgsOf(selection) })
      .catch(() => setChosen(undefined))
  }

  return {
    models,
    selection: chosen ?? selectionOfSessionRows({ models, rows, sessionId: args.sessionId }),
    pinnedRef,
    onSelect: handleSelect,
  }
}
