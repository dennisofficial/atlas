'use client'

import { CardRow } from '@dltech/atlas-ui/components/card'

import type { LibrarySecret } from '../fixtures/settings-library'
import { revealSecret } from '../data/personal/secrets-api'
import { LibraryRowMenu } from './library-row-menu'
import { SecretValueCell } from './secret-value-cell'

export function SecretRow({
  secret,
  onEdit,
  onDelete,
}: {
  secret: LibrarySecret
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <CardRow className="flex-row flex-wrap items-center">
      <div className="flex min-w-40 flex-1 items-center gap-2">
        <span className="truncate font-mono text-xs font-medium">{secret.key}</span>
      </div>
      <SecretValueCell
        name={secret.key}
        className="flex w-40 items-center gap-1"
        fetchValue={() => revealSecret(secret.key)}
      />
      <span className="w-24 text-right text-xs whitespace-nowrap text-muted-foreground">
        Updated {secret.updated}
      </span>
      <LibraryRowMenu
        label={secret.key}
        actions={[
          { label: 'Edit', onSelect: onEdit },
          { label: 'Delete', onSelect: onDelete, destructive: true },
        ]}
      />
    </CardRow>
  )
}
