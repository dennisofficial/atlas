import type { ApiClient } from '@dltech/atlas-api-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { listSessions } from '../../sessions/list-sessions'
import { type IModelOption, type IModelSelection } from '../../composer/model-options'
import { useModels } from '../../composer/use-models'
import { usePinnedModels } from '../../composer/use-pinned-models'
import { useSettings } from '../../settings/settings-provider'
import { choiceOfSessionRows, modelSetArgsOf, selectionOfChoice } from './session-commands'

export type SessionModelSheet = {
  open: boolean
  onClose: () => void
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinned: readonly string[]
  personalId: string
  onPinnedChange: (ids: string[]) => void
  onSelect: (selection: IModelSelection | null) => void
}

export const useSessionModelChoice = (args: {
  api: ApiClient | undefined
  sessionId: string
  open: boolean
}): Omit<SessionModelSheet, 'open' | 'onClose'> => {
  const { models } = useModels()
  const { pinned, setPinned } = usePinnedModels()
  const settings = useSettings()
  const personalId = settings.read({ key: 'model.id', schema: z.string() })
  const [current, setCurrent] = useState<IModelSelection | null | undefined>(undefined)
  const [chosen, setChosen] = useState<IModelSelection | null | undefined>(undefined)

  useEffect(() => {
    if (!args.open || current !== undefined || args.api === undefined) return
    let cancelled = false
    void listSessions({ api: args.api })
      .then((sessions) => {
        if (cancelled) return
        setCurrent(
          selectionOfChoice({
            models,
            choice: choiceOfSessionRows(sessions, args.sessionId),
          }),
        )
      })
      .catch(() => {
        if (!cancelled) setCurrent(null)
      })
    return () => {
      cancelled = true
    }
  }, [args.open, args.api, args.sessionId, current, models])

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
    selection: chosen === undefined ? (current ?? null) : chosen,
    pinned,
    personalId,
    onPinnedChange: setPinned,
    onSelect: handleSelect,
  }
}
