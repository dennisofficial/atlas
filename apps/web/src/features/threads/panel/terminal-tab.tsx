'use client'

import { TerminalPanel } from '@dltech/atlas-ui/ai/terminal-panel'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import {
  podDetailOf,
  terminalConnectionOf,
  useChannelConnection,
} from '../data/terminal-connection'
import { MAX_TERMINALS, tabLabelOf } from '../data/terminal-session-set'
import { useSend } from '../data/use-send'
import { useTerminals } from '../data/use-terminals'
import { ShellBar } from './terminal/shell-bar'
import { ShellScreen } from './terminal/shell-screen'
import { useThreadPanel } from './thread-panel-context'

const DISCONNECTED_MESSAGE = 'Connection lost. Reconnect to open fresh shells.'

export function TerminalTab() {
  const { channel, pod, threadId, refreshPod } = useThreadPanel()
  const { retryBoot } = useSend()
  const channelConnection = useChannelConnection(channel)
  const connection = terminalConnectionOf({
    pod,
    connection: channelConnection,
  })
  const { set, view } = useTerminals({
    channel,
    connected: connection === ETerminalConnection.Connected,
  })
  const active = view.tabs.find((tab) => tab.id === view.activeId) ?? view.tabs[0]

  const handleReconnect = () => {
    if (channel !== null && connection === ETerminalConnection.Disconnected) {
      channel.reconnect()
      return
    }
    void retryBoot(threadId).then(refreshPod)
  }
  const handleActiveChange = (id: string) => set?.select(id)
  const handleNew = () => void set?.add()
  const handleClose = (id: string) => set?.close(id)

  return (
    <TerminalPanel
      connection={connection}
      tabs={view.tabs.map((tab) => ({ id: tab.id, label: tabLabelOf(tab) }))}
      activeId={active?.id ?? ''}
      onActiveChange={handleActiveChange}
      onNew={view.tabs.length < MAX_TERMINALS ? handleNew : undefined}
      onReconnect={handleReconnect}
      detail={podDetailOf(pod)}
      disconnectedMessage={DISCONNECTED_MESSAGE}
    >
      {set !== null && active !== undefined ? (
        <>
          <ShellBar tab={active} onClose={handleClose} />
          {view.tabs.map((tab) => (
            <div
              key={`${tab.id}-${view.epoch}`}
              className={tab.id === active.id ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
            >
              <ShellScreen set={set} tab={tab} />
            </div>
          ))}
        </>
      ) : null}
    </TerminalPanel>
  )
}
