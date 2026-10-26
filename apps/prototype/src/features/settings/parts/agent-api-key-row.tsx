import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { Button } from '@dltech/atlas-ui/components/button'

import {
  KEY_PREFIXES,
  type ApiKeyEntry,
  type ApiKeyProvider,
} from '@dltech/atlas-ui/fixtures/settings-agent'
import { MonogramTile, Mono, SettingsRow } from '../settings-layout'
import { KeyDialog } from './agent-key-dialog'

export function ApiKeyRow({
  provider,
  entry,
  onSave,
  onRemove,
}: {
  provider: ApiKeyProvider
  entry: ApiKeyEntry | null
  onSave: (key: string) => void
  onRemove: () => void
}) {
  const prefix = KEY_PREFIXES[provider.id]
  const placeholder = prefix ? `${prefix}…` : 'Paste your API key'
  return (
    <SettingsRow
      media={
        provider.brand ? (
          <BrandMark brand={provider.brand} />
        ) : (
          <MonogramTile label={provider.name} />
        )
      }
      title={provider.name}
      description={
        entry ? (
          <span className="flex items-center gap-2">
            <Mono className="text-foreground">{entry.masked}</Mono>
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
              envVar={provider.envVar}
              triggerLabel="Replace"
              onSave={onSave}
            />
            <Button variant="outline" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <KeyDialog
            providerName={provider.name}
            placeholder={placeholder}
            envVar={provider.envVar}
            triggerLabel="Add key"
            onSave={onSave}
          />
        )
      }
    />
  )
}
