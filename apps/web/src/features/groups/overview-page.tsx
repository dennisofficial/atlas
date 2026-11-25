'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Input } from '@dltech/atlas-ui/components/input'
import { FolderPlusIcon } from 'lucide-react'

import { runAction } from '@/features/settings/data/shared/run-action'

import { useGroupContext } from './data/group-context'
import { GROUPS_HREF } from './group-settings-nav'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from '@/features/project-settings/settings-layout'

function NoProjects() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderPlusIcon />
        </EmptyMedia>
        <EmptyTitle>No projects in this group</EmptyTitle>
        <EmptyDescription>
          Assign a project here or from the groups page, and it inherits everything the group sets.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function GroupOverviewPage() {
  const { group, projects, save } = useGroupContext()
  const [name, setName] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const trimmed = name.trim()
  const dirty = trimmed !== group.name
  const invalid = trimmed === ''

  const handleSave = async () => {
    setSaving(true)
    await runAction({
      work: () => save({ id: group.id, name: trimmed }),
      success: 'Group saved',
    })
    setSaving(false)
  }

  return (
    <>
      <SettingsSection
        title="Overview"
        description="A group shares its access, settings, skills and MCP servers with every project in it."
      >
        <SettingsCard
          footer={
            <>
              <UnsavedHint visible={dirty} />
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => setName(group.name)}>
                  Discard
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={!dirty || invalid || saving}
                onClick={() => void handleSave()}
              >
                Save
              </Button>
            </>
          }
        >
          <SettingsRow
            title="Name"
            htmlFor="group-name"
            description="Shown on the groups page and on every project in the group."
          >
            <Input
              id="group-name"
              aria-invalid={invalid || undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Projects"
        description="Each project inherits the group layers below its own project layer."
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={GROUPS_HREF} />}
          >
            Assign projects
          </Button>
        }
      >
        <SettingsCard>
          {projects.length === 0 ? (
            <NoProjects />
          ) : (
            projects.map((project) => (
              <SettingsRow
                key={project.id}
                title={project.name}
                description={project.repo ?? 'No repository'}
              >
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={`/projects/${encodeURIComponent(project.id)}/settings/overview`} />
                  }
                >
                  Open
                </Button>
              </SettingsRow>
            ))
          )}
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
