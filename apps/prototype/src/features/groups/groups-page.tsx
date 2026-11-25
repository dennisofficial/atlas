'use client'

import Link from 'next/link'
import { FolderPlusIcon, PlusIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'

import { SettingsPage, SettingsSection } from '../settings/settings-layout'
import { GROUPS } from './fixtures/groups'

export function GroupsPage() {
  return (
    <SettingsPage
      title="Groups"
      description="A group shares secrets, files, settings, skills and MCP servers with every project in it."
      actions={
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          New group
        </Button>
      }
    >
      {GROUPS.map((group) => (
        <SettingsSection
          key={group.id}
          title={group.name}
          description={group.summary}
          actions={
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/groups/${group.id}/settings/overview`} />}
            >
              Open settings
            </Button>
          }
        >
          <Card variant="list">
            {group.projects.map((project) => (
              <CardRow key={project.id} className="flex-row items-center">
                <FolderPlusIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{project.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {project.repo}
                  </span>
                </span>
                <Badge variant="outline">Inherits group</Badge>
              </CardRow>
            ))}
          </Card>
        </SettingsSection>
      ))}
    </SettingsPage>
  )
}
