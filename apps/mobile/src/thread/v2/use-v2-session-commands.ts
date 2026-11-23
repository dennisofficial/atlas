import type { ApiClient } from '@dltech/atlas-api-router'
import { EClientAction, type CommandEntry } from '@dltech/atlas-commands'
import type { V2Event } from '@dltech/atlas-core'
import { useEffect, useMemo, useState } from 'react'

import { composerActionsOf, mobileEntriesOf } from './session-commands'
import { useSessionModelChoice } from './use-session-model-choice'

const NO_COMMANDS: readonly CommandEntry[] = []

export type V2SessionCommands = {
  entries: readonly CommandEntry[]
  clientActions: Record<EClientAction, () => void>
  model: ReturnType<typeof useSessionModelChoice> & { open: boolean; onClose: () => void }
  commandList: { open: boolean; onClose: () => void }
}

export const useV2SessionCommands = (args: {
  api: ApiClient | undefined
  sessionId: string
  events: readonly V2Event[]
}): V2SessionCommands => {
  const [commands, setCommands] = useState<readonly CommandEntry[]>(NO_COMMANDS)
  const [modelOpen, setModelOpen] = useState(false)
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

  const entries = useMemo(
    () => mobileEntriesOf({ commands, events: args.events }),
    [commands, args.events],
  )
  const clientActions = useMemo(
    () =>
      composerActionsOf({
        openModelPicker: () => setModelOpen(true),
        openCommandList: () => setListOpen(true),
      }),
    [],
  )
  const model = useSessionModelChoice({
    api: args.api,
    sessionId: args.sessionId,
    open: true,
  })

  return {
    entries,
    clientActions,
    model: { ...model, open: modelOpen, onClose: () => setModelOpen(false) },
    commandList: { open: listOpen, onClose: () => setListOpen(false) },
  }
}
