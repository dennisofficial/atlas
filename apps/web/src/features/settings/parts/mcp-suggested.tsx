import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { Button } from '@dltech/atlas-ui/components/button'

import { SUGGESTED_MCP_SERVERS } from '../fixtures/settings-mcp'
import { SettingsSection } from '../settings-layout'

export function McpSuggested() {
  return (
    <SettingsSection title="Suggested" description="Popular servers you can connect in one step.">
      <div className="grid grid-cols-2 gap-3">
        {SUGGESTED_MCP_SERVERS.map((server) => (
          <div key={server.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <BrandMark brand={server.brand} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{server.name}</span>
              <p className="text-xs text-muted-foreground">{server.description}</p>
            </div>
            <Button variant="outline" size="xs">
              Connect
            </Button>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
