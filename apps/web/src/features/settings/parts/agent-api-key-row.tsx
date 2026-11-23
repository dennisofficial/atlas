'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { ScaleIcon } from 'lucide-react'

import { KEY_PREFIXES, type ApiKeyEntry, type ApiKeyProvider } from '../fixtures/settings-agent'
import { Mono, SettingsRow } from '../settings-layout'
import { KeyDialog } from './agent-key-dialog'

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
  onSave: (key: string) => Promise<string | null>
  onRemove: () => void
}) {
  const prefix = KEY_PREFIXES[provider.id]
  const placeholder = prefix.length > 0 ? `${prefix}…` : 'Paste your API key'
  return (
    <SettingsRow
      media={
        provider.brand === undefined ? (
          <ScaleIcon className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <BrandMark brand={provider.brand} />
        )
      }
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
              placeholder={placeholder}
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
            placeholder={placeholder}
            triggerLabel="Add key"
            onSave={onSave}
          />
        )
      }
    />
  )
}
