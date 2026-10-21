'use client'

import { Button } from '@dltech/atlas-ui/components/button'

import { KEY_PREFIXES, type ApiKeyEntry, type ApiKeyProvider } from '../fixtures/settings-agent'
import { Mono, SettingsRow } from '../settings-layout'
import { KeyDialog } from './agent-key-dialog'
import { ProviderTile } from './agent-provider-tile'

export function ApiKeyRow({
  provider,
  entry,
  busy = false,
  onSave,
  onRemove,
}: {
  provider: ApiKeyProvider
  entry: ApiKeyEntry | null
  busy?: boolean
  onSave: (key: string) => void
  onRemove: () => void
}) {
  const prefix = KEY_PREFIXES[provider.id]
  return (
    <SettingsRow
      media={<ProviderTile letter={provider.letter} />}
      title={provider.name}
      description={
        entry ? (
          <span className="flex items-center gap-2">
            <Mono className="text-foreground">{entry.label}</Mono>
            <span className="text-xs">{entry.added}</span>
          </span>
        ) : (
          provider.description
        )
      }
      control={
        entry ? (
          <>
            <KeyDialog
              providerName={provider.name}
              placeholder={`${prefix}…`}
              triggerLabel="Replace"
              onSave={onSave}
            />
            <Button variant="outline" size="sm" disabled={busy} onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <KeyDialog
            providerName={provider.name}
            placeholder={`${prefix}…`}
            triggerLabel="Add key"
            onSave={onSave}
          />
        )
      }
    />
  )
}
