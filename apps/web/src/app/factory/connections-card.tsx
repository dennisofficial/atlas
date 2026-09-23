import { Badge } from '@dltech/atlas-ui/badge'
import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'

import type { FactoryConnection } from '../../lib/factory-api'

type ProviderRow = {
  provider: 'linear' | 'github'
  label: string
  installPath: string
}

const PROVIDERS: ProviderRow[] = [
  { provider: 'linear', label: 'Linear', installPath: '/v1/factory/linear/install' },
  { provider: 'github', label: 'GitHub', installPath: '/v1/factory/github/install' },
]

type ConnectionsCardProps = {
  connections: FactoryConnection[]
  organizationMissing: boolean
}

export function ConnectionsCard({ connections, organizationMissing }: ConnectionsCardProps) {
  return (
    <Card title="Connections" subtitle="Providers the factory works through">
      {organizationMissing ? (
        <p className="text-sm text-meta">
          Select or create an active organization to manage connections.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {PROVIDERS.map(({ provider, label, installPath }) => {
            const connection = connections.find((row) => row.provider === provider)
            return (
              <li key={provider} className="flex items-center justify-between gap-4">
                <span className="text-sm text-foreground">{label}</span>
                {connection === undefined ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={installPath}>Connect {label}</a>
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-hint">
                      {connection.externalAccountId}
                    </span>
                    <Badge tone={connection.status === 'active' ? 'success' : 'warning'} dot>
                      {connection.status}
                    </Badge>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
