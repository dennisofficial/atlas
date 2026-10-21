'use client'

import { useState } from 'react'
import { PlusIcon, PuzzleIcon } from 'lucide-react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import { PLUGINS, type LibraryPlugin } from '../fixtures/settings-library'
import { LibraryConfirmDialog } from '../parts/library-confirm-dialog'
import { LibraryInstallDialog } from '../parts/library-install-dialog'
import { PluginRow } from '../parts/library-plugin-row'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

export function PluginsPage({ initial = PLUGINS }: { initial?: LibraryPlugin[] }) {
  const [plugins, setPlugins] = useState(initial)
  const [uninstalling, setUninstalling] = useState<LibraryPlugin | null>(null)

  const handleAdd = (source: string) => {
    const name = source.split('/').pop() ?? source
    setPlugins((current) => [
      {
        id: `new-${name}`,
        name,
        version: '0.1.0',
        description: 'Added just now. Configure it to choose which hooks run.',
        hooks: 1,
        tools: 1,
        promptFragments: 0,
        enabled: true,
      },
      ...current,
    ])
  }

  const handleToggle = ({ id, enabled }: { id: string; enabled: boolean }) =>
    setPlugins((current) =>
      current.map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin)),
    )

  const handleUninstall = () => {
    setPlugins((current) => current.filter((plugin) => plugin.id !== uninstalling?.id))
    setUninstalling(null)
  }

  return (
    <SettingsPage
      title="Plugins"
      description="Plugins contribute hooks, tools, and prompt fragments to every session you start."
      actions={
        <LibraryInstallDialog
          triggerLabel="Add plugin"
          triggerIcon={<PlusIcon />}
          title="Add plugin"
          description="Enter an npm package name or a path to a local plugin directory."
          label="Package name or path"
          placeholder="@dltech/atlas-plugin-linear or ./plugins/lint-guard"
          submitLabel="Add plugin"
          onSubmit={handleAdd}
        />
      }
    >
      <SettingsSection title="Installed" description="Enabled plugins load when a session starts.">
        {plugins.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PuzzleIcon />
              </EmptyMedia>
              <EmptyTitle>No plugins installed yet.</EmptyTitle>
              <EmptyDescription>
                Add a package or a local path to extend what the agent can do.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SettingsCard>
            {plugins.map((plugin) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                onToggle={(enabled) => handleToggle({ id: plugin.id, enabled })}
                onConfigure={() => undefined}
                onUninstall={() => setUninstalling(plugin)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <LibraryConfirmDialog
        open={uninstalling !== null}
        onOpenChange={(open) => (open ? undefined : setUninstalling(null))}
        title={`Uninstall ${uninstalling?.name ?? 'plugin'}?`}
        description="Its hooks, tools, and prompt fragments stop loading in new sessions."
        confirmLabel="Uninstall"
        onConfirm={handleUninstall}
      />
    </SettingsPage>
  )
}
