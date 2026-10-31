import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { surfaceCommands, type CommandSpec } from '@dltech/atlas-core'
import { EConnectionView, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'

import { requestOpenSearch } from '../../shell/search-events'
import { useThreadBackend } from '../data/use-thread-backend'
import { ERightTab } from '../panel/right-tab'
import type { RightPanelState } from '../panel/use-right-panel'
import { dispatchSubmission, EDispatch } from './dispatch'
import { webCommandHandlers } from './web-command-handlers'
import { useCommandList } from './use-command-list'

export function useThreadCommands(args: {
  threadId: string
  channel: RemoteDeltaChannel | null
  live: boolean
  projectId: string | null | undefined
  working: boolean
  rightPanel: Pick<RightPanelState, 'setTab' | 'setSheetOpen'>
  retryBoot: (threadId: string) => Promise<void>
  refresh: () => void
  onRenamed: () => void
}) {
  const backend = useThreadBackend()
  const [modelOpen, setModelOpen] = useState(false)
  const router = useRouter()
  const list = useCommandList({
    channel: args.channel,
    live: args.live,
    projectId: args.projectId,
  })
  const { channel, threadId, retryBoot, refresh, onRenamed } = args
  const rename = backend.local ? backend.rename : undefined
  const { setTab, setSheetOpen } = args.rightPanel
  const openModelPicker = useCallback(() => setModelOpen(true), [])
  const openDetails = useCallback(() => {
    setTab(ERightTab.Details)
    setSheetOpen(true)
  }, [setTab, setSheetOpen])
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
        ...(rename === undefined
          ? {}
          : {
              rename: async (target: { threadId: string; title: string }) => {
                await rename(target)
                onRenamed()
              },
            }),
      }),
    [channel, threadId, openModelPicker, openDetails, wake, router, list.reload, rename, onRenamed],
  )
  const commands = useMemo(() => surfaceCommands({ handlers }), [handlers])
  const specs = useMemo<readonly CommandSpec[]>(
    () => [...commands, ...list.skills],
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

  return { specs, handleCommand, modelOpen, setModelOpen }
}
