import { GlobeIcon, TerminalIcon } from 'lucide-react'

import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EMcpOAuthState, EMcpTransport, type McpServer } from '../../../fixtures/settings-mcp'
import { LibraryRowMenu, type LibraryMenuAction } from '../../settings/parts/library-row-menu'
import { brandFor, targetOf } from './mcp-model'
import { McpStatus } from './mcp-status'

function ServerTile({ server }: { server: McpServer }) {
  const brand = brandFor(server.name)
  if (brand) return <BrandMark brand={brand} />
  const Icon = server.spec.transport === EMcpTransport.Stdio ? TerminalIcon : GlobeIcon
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  )
}

export function McpRow({
  server,
  overridesPersonal,
  shadowed,
  onToggle,
  onEdit,
  onSignIn,
  onSignOut,
  onRemove,
}: {
  server: McpServer
  overridesPersonal: boolean
  shadowed: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onSignIn: () => void
  onSignOut: () => void
  onRemove: () => void
}) {
  const signedIn =
    server.connection !== null && server.connection.state !== EMcpOAuthState.SignInRequired
  const actions: LibraryMenuAction[] = [
    { label: 'Edit', onSelect: onEdit },
    ...(signedIn ? [{ label: 'Sign out', onSelect: onSignOut }] : []),
    { label: 'Remove', onSelect: onRemove, destructive: true },
  ]

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3',
        !server.enabled && 'opacity-60',
        shadowed && 'opacity-50',
      )}
    >
      <ServerTile server={server} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className={cn('font-mono text-sm font-medium', shadowed && 'line-through')}>
            {server.name}
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
          {server.connection ? (
            <McpStatus connection={server.connection} onSignIn={onSignIn} />
          ) : null}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {targetOf(server.spec)}
        </span>
      </div>
      <Switch
        aria-label={`Enable ${server.name}`}
        checked={server.enabled}
        onCheckedChange={onToggle}
      />
      <LibraryRowMenu label={server.name} actions={actions} />
    </div>
  )
}
