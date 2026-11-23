import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { surfaceCommands } from '@dltech/atlas-core'
import { EConnectionView, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import type { CommandEntry } from '@dltech/atlas-commands'

import { requestOpenSearch } from '../../shell/search-events'
import { ERightTab } from '../panel/right-tab'
import type { RightPanelState } from '../panel/use-right-panel'
import { dispatchSubmission, EDispatch } from './dispatch'
import { webCommandHandlers } from './web-command-handlers'
import { useCommandList } from './use-command-list'
import { menuEntryOfSpec } from './v1-entries'

export function useThreadCommands(args: {
  threadId: string
  channel: RemoteDeltaChannel | null
  live: boolean
  working: boolean
  rightPanel: Pick<RightPanelState, 'setTab' | 'openPanel'>
  retryBoot: (threadId: string) => Promise<void>
  refresh: () => void
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const router = useRouter()
  const list = useCommandList({ channel: args.channel, live: args.live })
  const { channel, threadId, retryBoot, refresh } = args
  const { setTab, openPanel } = args.rightPanel
  const openModelPicker = useCallback(() => setModelOpen(true), [])
  const openDetails = useCallback(() => {
    setTab(ERightTab.Details)
    openPanel()
  }, [setTab, openPanel])
  const wake = useCallback(async () => {
    await retryBoot(threadId)
    refresh()
  }, [retryBoot, threadId, refresh])

  const handlers = useMemo(
    () =>
      webCommandHandlers({
        threadId,
        request: (call) => {
          if (channel === null) return null
          if (channel.connection().state !== EConnectionView.Connected) return null
          return channel.request(call)
        },
        operationId: () => crypto.randomUUID(),
        openModelPicker,
        openSearch: requestOpenSearch,
        openDetails,
        navigate: (href) => router.push(href),
        wake,
        reloadSkills: list.reload,
      }),
    [channel, threadId, openModelPicker, openDetails, wake, router, list.reload],
  )
  const commands = useMemo(() => surfaceCommands({ handlers }), [handlers])
  const entries = useMemo<readonly CommandEntry[]>(
    () => [...commands, ...list.skills].map(menuEntryOfSpec),
    [commands, list.skills],
  )

  const handleCommand = async (text: string): Promise<boolean> => {
    const result = await dispatchSubmission({
      text,
      handlers,
      commands,
      skills: list.skills,
      working: args.working,
    })
    if (result.type === EDispatch.Send) return false
    if (result.type === EDispatch.Refused) toast.error(result.reason)
    else if (result.notice !== undefined) toast(result.notice)
    return true
  }

  return { entries, handleCommand, modelOpen, setModelOpen }
}
