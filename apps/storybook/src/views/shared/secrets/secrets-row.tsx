import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ESecretKind, type LibrarySecret } from '../../../fixtures/settings-library'
import { LibraryRowMenu, type LibraryMenuAction } from '../../settings/parts/library-row-menu'

const MASK = '••••••••'

function EnvValue({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="min-w-0 truncate font-mono text-xs text-muted-foreground" />}
      >
        {value}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm font-mono break-all">
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

function SecretValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <>
      <span
        className={cn(
          'min-w-0 truncate font-mono text-xs',
          revealed ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {revealed ? value : MASK}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={revealed ? 'Hide value' : 'Show value'}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </>
  )
}

export function SecretRow({
  secret,
  overridesPersonal,
  shadowed,
  onEdit,
  onDelete,
}: {
  secret: LibrarySecret
  overridesPersonal: boolean
  shadowed: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const handleCopyKey = () => {
    void navigator.clipboard?.writeText(secret.key)
  }

  const actions: LibraryMenuAction[] = [
    { label: 'Edit', onSelect: onEdit },
    { label: 'Copy key', onSelect: handleCopyKey },
    { label: 'Delete', onSelect: onDelete, destructive: true },
  ]

  return (
    <div className={cn('flex items-center gap-3 px-4 py-2.5', shadowed && 'opacity-50')}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn('truncate font-mono text-xs font-medium', shadowed && 'line-through')}>
          {secret.key}
        </span>
        {overridesPersonal ? (
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            overrides personal
          </span>
        ) : null}
        {shadowed ? (
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            overridden in this project
          </span>
        ) : null}
      </div>
      <div className="flex w-52 min-w-0 items-center gap-1">
        {secret.kind === ESecretKind.EnvVar ? (
          <EnvValue value={secret.value} />
        ) : (
          <SecretValue value={secret.value} />
        )}
      </div>
      <span className="w-20 text-right text-xs whitespace-nowrap text-muted-foreground">
        {secret.updated}
      </span>
      <LibraryRowMenu label={secret.key} actions={actions} />
    </div>
  )
}
