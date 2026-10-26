import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EMcpOAuthState, type McpConnection } from '../../settings/fixtures/settings-mcp'

type StatusLook = { label: string; className: string; action?: string }

function lookFor(connection: McpConnection): StatusLook {
  switch (connection.state) {
    case EMcpOAuthState.Connected:
      return { label: `Connected as ${connection.account ?? 'you'}`, className: 'text-success' }
    case EMcpOAuthState.SignInRequired:
      return { label: 'Sign in required', className: 'text-muted-foreground', action: 'Sign in' }
    case EMcpOAuthState.Expired:
      return { label: 'Expired', className: 'text-warning', action: 'Reconnect' }
    case EMcpOAuthState.Failed:
      return {
        label: `Failed: ${connection.reason ?? 'unknown error'}`,
        className: 'text-destructive',
        action: 'Retry',
      }
  }
}

export function McpStatus({
  connection,
  onSignIn,
}: {
  connection: McpConnection
  onSignIn: () => void
}) {
  const look = lookFor(connection)
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <span className={cn('flex min-w-0 items-center gap-1.5', look.className)}>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
        <span className="truncate">{look.label}</span>
      </span>
      {look.action ? (
        <Button variant="outline" size="xs" onClick={onSignIn}>
          {look.action}
        </Button>
      ) : null}
    </span>
  )
}
