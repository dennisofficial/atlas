import type { ApiClient } from '@dltech/atlas-api-router'
import { useState } from 'react'
import { z } from 'zod'

import { type IModelOption, type IModelSelection } from '../../composer/model-options'
import { useModels } from '../../composer/use-models'
import { useSettings } from '../../settings/settings-provider'
import { choiceOfSessionRows, modelSetArgsOf, selectionOfSessionRows } from './session-commands'
import { useSessionRows } from './use-session-rows'

export type SessionModelChoice = {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinnedRef: string | null
  personalId: string
  onSelect: (selection: IModelSelection | null) => void
}

export const useSessionModelChoice = (args: {
  api: ApiClient | undefined
  sessionId: string
}): SessionModelChoice => {
  const { models } = useModels()
  const settings = useSettings()
  const rows = useSessionRows()
  const personalId = settings.read({ key: 'model.id', schema: z.string() })
  const [chosen, setChosen] = useState<IModelSelection | null | undefined>(undefined)
  const pinnedRef = choiceOfSessionRows(rows ?? [], args.sessionId)?.ref ?? null

  const handleSelect = (selection: IModelSelection | null) => {
    setChosen(selection)
    if (args.api === undefined) return
    const payload = modelSetArgsOf({ selection, personalId })
    if (payload === null) return
    void args.api.sessions.command
      .mutate({ sessionId: args.sessionId, name: 'model-set', args: payload })
      .catch(() => setChosen(undefined))
  }

  return {
    models,
    selection: chosen ?? selectionOfSessionRows({ models, rows, sessionId: args.sessionId }),
    pinnedRef,
    personalId,
    onSelect: handleSelect,
  }
}
