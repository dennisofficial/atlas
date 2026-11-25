'use client'

import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

import { SettingsPage, SettingsSection } from '../settings/settings-layout'
import { groupById } from './fixtures/groups'

export function GroupOverviewPage({ groupId }: { groupId: string }) {
  const group = groupById(groupId)
  if (group === null) return null
  return (
    <SettingsPage
      title={group.name}
      description="A group shares its access, settings, skills and MCP servers with every project in it."
    >
      <SettingsSection title="Overview">
        <Card variant="list">
          <CardRow className="flex-col items-stretch gap-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" defaultValue={group.name} />
          </CardRow>
        </Card>
      </SettingsSection>
      <SettingsSection
        title="Projects"
        description="Each project inherits the group layers below its own project layer."
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/settings/groups" />}
          >
            Assign projects
          </Button>
        }
      >
        <Card variant="list">
          {group.projects.map((project) => (
            <CardRow key={project.id} className="flex-row items-center">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{project.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {project.repo}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/projects/${project.id}/settings/overview`} />}
              >
                Open
              </Button>
            </CardRow>
          ))}
        </Card>
      </SettingsSection>
    </SettingsPage>
  )
}
