'use client'

import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { KEY_PREFIXES, type ApiKeyEntry, type ApiKeyProvider } from '../fixtures/settings-agent'
import { Mono, SettingsRow } from '../settings-layout'
import { KeyDialog } from './agent-key-dialog'
import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'

export function ApiKeyRow({
  provider,
  entry,
  busy = false,
  availability,
  onSave,
  onRemove,
}: {
  provider: ApiKeyProvider
  entry: ApiKeyEntry | null
  busy?: boolean
  availability?: ReactNode
  onSave: (key: string) => void
  onRemove: () => void
}) {
  const prefix = KEY_PREFIXES[provider.id]
  const placeholder = prefix.length > 0 ? `${prefix}…` : 'Paste your API key'
  return (
    <SettingsRow
      media={<BrandMark brand={provider.brand} />}
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
    >
      {entry ? availability : null}
    </SettingsRow>
  )
}
