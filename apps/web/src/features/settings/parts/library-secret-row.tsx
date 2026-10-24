'use client'

import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { CardRow } from '@dltech/atlas-ui/components/card'

import { ESecretKind, type LibrarySecret } from '../fixtures/settings-library'
import { LibraryRowMenu } from './library-row-menu'

const MASK = '••••••••'

export function SecretRow({
  secret,
  showAddedBy,
  onEdit,
  onDelete,
}: {
  secret: LibrarySecret
  showAddedBy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const isEnvVar = secret.kind === ESecretKind.EnvVar

  return (
    <CardRow className="flex-row items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-mono text-xs font-medium">{secret.key}</span>
        <Badge variant={isEnvVar ? 'outline' : 'secondary'}>
          {isEnvVar ? 'Env var' : 'Secret'}
        </Badge>
      </div>
      <div className="flex w-40 items-center gap-1">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {isEnvVar && revealed ? secret.value : MASK}
        </span>
        {isEnvVar ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={revealed ? 'Hide value' : 'Reveal value'}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        ) : null}
      </div>
      {showAddedBy ? (
        <div className="flex w-28 items-center gap-2">
          <Avatar size="sm">
            <AvatarFallback>{secret.addedBy.initials}</AvatarFallback>
          </Avatar>
          <span className="truncate text-xs text-muted-foreground">
            {secret.addedBy.name.split(' ')[0]}
          </span>
        </div>
      ) : null}
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
