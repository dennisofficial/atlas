'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FolderPlusIcon, PlusIcon } from 'lucide-react'
import type { Project, ProjectGroup } from '@dltech/atlas-wire/web'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import {
  GROUP_DELETE_DESCRIPTION,
  GROUP_DESCRIPTION,
  groupCandidatesOf,
  groupMemberSummaryOf,
  groupMembersOf,
} from '@dltech/atlas-client/settings'

import { fetchProjects } from '@/features/projects/data/projects-api'
import { GroupNameDialog } from '@/features/groups/group-name-dialog'
import { useGroups } from '@/features/groups/data/use-groups'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'
import { QueryGate } from '../data/shared/query-gate'
import { runAction } from '../data/shared/run-action'
import { LibraryConfirmDialog } from '../parts/library-confirm-dialog'
import { LibraryRowMenu } from '../parts/library-row-menu'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from '../settings-layout'

const TITLE = 'Groups'

const SKELETON_KEYS = ['a', 'b']

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; group: ProjectGroup }
  | { kind: 'delete'; group: ProjectGroup }

function AddProjectMenu({
  projects,
  onAssign,
}: {
  projects: readonly Project[]
  onAssign: (projectId: string) => Promise<void>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        Add project
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {projects.map((project) => (
          <DropdownMenuItem key={project.id} onClick={() => void onAssign(project.id)}>
            {project.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GroupCard({
  group,
  projects,
  onRename,
  onDelete,
  onAssign,
  onRemove,
}: {
  group: ProjectGroup
  projects: readonly Project[]
  onRename: () => void
  onDelete: () => void
  onAssign: (projectId: string) => Promise<void>
  onRemove: (projectId: string) => Promise<unknown>
}) {
  const members = groupMembersOf({ projects, groupId: group.id })
  const candidates = groupCandidatesOf({ projects, groupId: group.id })
  return (
    <SettingsSection
      title={group.name}
      description={groupMemberSummaryOf(members.length)}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/groups/${encodeURIComponent(group.id)}/settings/overview`} />}
          >
            Open settings
          </Button>
          <LibraryRowMenu
            label={group.name}
            actions={[
              { label: 'Rename', onSelect: onRename },
              { label: 'Delete', onSelect: onDelete, destructive: true },
            ]}
          />
        </>
      }
    >
      <SettingsCard
        footer={
          candidates.length === 0 ? undefined : (
            <AddProjectMenu projects={candidates} onAssign={onAssign} />
          )
        }
      >
        {members.map((project) => (
          <SettingsRow
            key={project.id}
            title={project.name}
            description={project.repo ?? 'No repository'}
            control={
              <Button variant="ghost" size="sm" onClick={() => void onRemove(project.id)}>
                Remove
              </Button>
            }
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

function GroupsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderPlusIcon />
        </EmptyMedia>
        <EmptyTitle>No groups yet</EmptyTitle>
        <EmptyDescription>
          Group the projects that share a stack, then set a secret, skill or MCP server once for all
          of them.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon data-icon="inline-start" />
          New group
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function GroupsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {SKELETON_KEYS.map((key) => (
        <Skeleton key={key} className="h-24 w-full" />
      ))}
    </div>
  )
}

export function GroupsPage() {
  const groups = useGroups()
  const projects = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })
  const projectRows = projects.state === EQueryState.Ready ? projects.data : []

  const handleSave = async (name: string): Promise<boolean> => {
    const id = dialog.kind === 'rename' ? dialog.group.id : undefined
    const saved = await runAction({
      work: () => groups.save(id === undefined ? { name } : { id, name }),
      success: id === undefined ? `Created ${name}` : `Renamed to ${name}`,
    })
    return saved
  }

  const handleDelete = () => {
    if (dialog.kind !== 'delete') return
    const doomed = dialog.group
    setDialog({ kind: 'none' })
    void runAction({ work: () => groups.remove(doomed.id), success: `Deleted ${doomed.name}` })
  }

  const handleAssign = async (groupId: string, projectId: string): Promise<void> => {
    await runAction({ work: () => groups.assign({ projectId, groupId }) })
  }

  return (
    <SettingsPage
      title={TITLE}
      description={GROUP_DESCRIPTION}
      actions={
        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'create' })}>
          <PlusIcon data-icon="inline-start" />
          New group
        </Button>
      }
    >
      <QueryGate query={groups.query} label="groups" skeleton={<GroupsSkeleton />}>
        {(rows) =>
          rows.length === 0 ? (
            <GroupsEmpty onCreate={() => setDialog({ kind: 'create' })} />
          ) : (
            rows.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                projects={projectRows}
                onRename={() => setDialog({ kind: 'rename', group })}
                onDelete={() => setDialog({ kind: 'delete', group })}
                onAssign={(projectId) => handleAssign(group.id, projectId)}
                onRemove={(projectId) =>
                  runAction({
                    work: () => groups.assign({ projectId, groupId: null }),
                    success: 'Project ungrouped',
                  })
                }
              />
            ))
          )
        }
      </QueryGate>
      <GroupNameDialog
        open={dialog.kind === 'create' || dialog.kind === 'rename'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' })
        }}
        title={dialog.kind === 'rename' ? 'Rename group' : 'New group'}
        description="Every project in the group inherits what it sets."
        initialName={dialog.kind === 'rename' ? dialog.group.name : ''}
        submitLabel={dialog.kind === 'rename' ? 'Rename' : 'Create'}
        onSubmit={handleSave}
      />
      <LibraryConfirmDialog
        open={dialog.kind === 'delete'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' })
        }}
        title={`Delete ${dialog.kind === 'delete' ? dialog.group.name : ''}?`}
        description={GROUP_DELETE_DESCRIPTION}
        confirmLabel="Delete group"
        onConfirm={handleDelete}
      />
    </SettingsPage>
  )
}
