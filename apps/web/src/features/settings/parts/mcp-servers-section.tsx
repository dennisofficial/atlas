'use client'

import { toast } from 'sonner'

import { SettingsSection } from '../settings-layout'
import { McpAddDialog } from './mcp-add-dialog'
import { McpServerList } from './mcp-server-list'
import type { McpStore } from './mcp-store'

export function McpServersSection({
  title = 'MCP servers',
  description,
  store,
}: {
  title?: string
  description: string
  store: McpStore
}) {
  const run = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the change')
    }
  }

  return (
    <SettingsSection
      title={title}
      description={description}
      actions={<McpAddDialog onAdd={(draft) => void run(() => store.add(draft))} />}
    >
      <McpServerList
        servers={store.servers}
        onToggle={(change) => void run(() => store.toggle(change))}
        onRemove={(id) => void run(() => store.remove(id))}
      />
    </SettingsSection>
  )
}
