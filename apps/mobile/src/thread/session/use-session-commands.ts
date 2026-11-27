import type { ApiClient } from '@dltech/atlas-api-router'
import { EClientAction, type CommandEntry } from '@dltech/atlas-commands'
import type { RecordEvent } from '@dltech/atlas-core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { presentModelSheet } from '../../composer/model-sheet-request'

import { composerActionsOf, mobileEntriesOf } from './session-commands'
import { type SessionModelChoice, useSessionModelChoice } from './use-session-model-choice'

const NO_COMMANDS: readonly CommandEntry[] = []

export type SessionCommands = {
  entries: readonly CommandEntry[]
  clientActions: Record<EClientAction, () => void>
  model: SessionModelChoice
  commandList: { open: boolean; onClose: () => void }
}

export const useSessionCommands = (args: {
  api: ApiClient | undefined
  sessionId: string
  events: readonly RecordEvent[]
  reportHidden: (name: string) => void
}): SessionCommands => {
  const [commands, setCommands] = useState<readonly CommandEntry[]>(NO_COMMANDS)
  const [listOpen, setListOpen] = useState(false)

  useEffect(() => {
    if (args.api === undefined) return
    let cancelled = false
    void args.api.sessions.commands
      .query({})
      .then((response) => {
        if (!cancelled) setCommands(response.commands)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [args.api])

  const model = useSessionModelChoice({
    api: args.api,
    sessionId: args.sessionId,
  })
  const latestModel = useRef(model)
  latestModel.current = model

  const entries = useMemo(
    () => mobileEntriesOf({ commands, events: args.events }),
    [commands, args.events],
  )
  const clientActions = useMemo(
    () =>
      composerActionsOf({
        openModelPicker: () =>
          presentModelSheet({
            models: latestModel.current.models,
            selection: latestModel.current.selection,
            onSelect: latestModel.current.onSelect,
          }),
        openCommandList: () => setListOpen(true),
        reportHidden: args.reportHidden,
      }),
    [args.reportHidden],
  )
  return {
    entries,
    clientActions,
    model,
    commandList: { open: listOpen, onClose: () => setListOpen(false) },
  }
}
