import Link from 'next/link'
import { ArrowUpRightIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'

import { SettingsSection } from '../settings/settings-layout'

export type InheritedItem = { label: string; detail: string; overriddenBy?: string }

export type InheritedLayer = {
  title: string
  description: string
  editHref: string
  items: InheritedItem[]
}

export function InheritedLayersPreview({ layers }: { layers: readonly InheritedLayer[] }) {
  return (
    <>
      {layers.map((layer) => (
        <SettingsSection
          key={layer.title}
          title={layer.title}
          description={layer.description}
          actions={
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href={layer.editHref} />}
            >
              Edit
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          }
        >
          <Card variant="list">
            {layer.items.map((item) => (
              <CardRow
                key={item.label}
                className={
                  item.overriddenBy === undefined
                    ? 'flex-row items-center'
                    : 'flex-row items-center opacity-60'
                }
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-sm font-medium">{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                </div>
                {item.overriddenBy === undefined ? null : (
                  <Badge variant="outline">Overridden by {item.overriddenBy}</Badge>
                )}
              </CardRow>
            ))}
          </Card>
        </SettingsSection>
      ))}
    </>
  )
}

export const PERSONAL_LAYER: InheritedLayer = {
  title: 'From personal settings',
  description: 'Inherited unless a higher layer sets the same thing.',
  editHref: '/settings/access',
  items: [
    { label: 'GITHUB_TOKEN', detail: 'personal credentials grant', overriddenBy: 'project' },
    { label: 'LINEAR_API_KEY', detail: 'personal credentials grant' },
  ],
}

export const GROUP_LAYER: InheritedLayer = {
  title: 'From Comp AI group',
  description: 'Inherited unless the project sets the same thing.',
  editHref: '/groups/comp-ai/settings/access',
  items: [{ label: 'STRIPE_SECRET_KEY', detail: 'billing secrets grant', overriddenBy: 'project' }],
}

export const PERSONAL_SANDBOX_LAYER: InheritedLayer = {
  title: 'From personal settings',
  description: 'Inherited unless a higher layer sets the same thing.',
  editHref: '/settings/agent',
  items: [
    { label: 'vCPUs', detail: '4', overriddenBy: 'group' },
    { label: 'Memory (GB)', detail: '8', overriddenBy: 'group' },
    { label: 'Disk (GB)', detail: '40' },
  ],
}

export const PERSONAL_SKILLS_LAYER: InheritedLayer = {
  title: 'From personal settings',
  description: 'Inherited unless a higher layer sets the same thing.',
  editHref: '/settings/skills',
  items: [
    { label: 'code-review', detail: 'Review a diff for correctness', overriddenBy: 'group' },
    { label: 'commit', detail: 'Stage and write a conventional commit' },
  ],
}

export const PERSONAL_MCP_LAYER: InheritedLayer = {
  title: 'From personal settings',
  description: 'Inherited unless a higher layer sets the same thing.',
  editHref: '/settings/integrations',
  items: [{ label: 'linear', detail: 'npx -y mcp-linear', overriddenBy: 'group' }],
}
