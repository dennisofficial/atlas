'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@dltech/atlas-ui/components/input-group'

import {
  planGeneralSave,
  sanitizeSlug,
  validateGeneralDraft,
  type GeneralDraft,
} from '../data/workspace/general-mapping'
import { QueryGate } from '../data/workspace/query-gate'
import { ReadOnlyArea } from '../data/workspace/read-only-area'
import { formatDate } from '../data/workspace/relative-time'
import { runAction } from '../data/workspace/run-action'
import { useGeneralSettings } from '../data/workspace/use-general-settings'
import type { WorkspaceAccess } from '../data/workspace/use-workspace-access'
import { pageWrapOf, WorkspaceGate } from '../data/workspace/workspace-gate'
import { describeAccess } from '../data/workspace/workspace-role'
import {
  EWorkspaceRole,
  DEFAULT_MODEL_OPTIONS,
  REGION_OPTIONS,
} from '../fixtures/settings-workspace'
import { WorkspaceDangerZone } from '../parts/workspace-danger-zone'
import { WorkspaceDetailsCard, type WorkspaceDetails } from '../parts/workspace-details-card'
import { WorkspaceLogoTile } from '../parts/workspace-logo-tile'
import { WorkspaceSelect } from '../parts/workspace-select'
import {
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../settings-layout'
import { initialsOf } from '../session/initials'
import type { OrganizationDetails } from '../data/workspace/organization-details'

const TITLE = 'General'

function detailsOf(organization: OrganizationDetails): WorkspaceDetails {
  const owner = organization.members.find((member) => member.role.split(',').includes('owner'))
  const ownerName = owner === undefined ? '—' : owner.user.name || owner.user.email
  return {
    id: organization.id,
    createdAt: formatDate(organization.createdAt),
    ownerName,
    ownerInitials: owner === undefined ? '—' : initialsOf(ownerName),
  }
}

function GeneralForm({
  access,
  saved,
  details,
  onSave,
  onDelete,
}: {
  access: WorkspaceAccess
  saved: GeneralDraft
  details: OrganizationDetails
  onSave: (draft: GeneralDraft) => Promise<boolean>
  onDelete: () => Promise<boolean>
}) {
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const handleChange = (patch: Partial<GeneralDraft>) => setDraft({ ...draft, ...patch })

  const handleSave = async () => {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }
  const handleDelete = async () => {
    setDeleting(true)
    const ok = await onDelete()
    if (!ok) setDeleting(false)
  }

  return (
    <SettingsPage
      title={TITLE}
      description={describeAccess({
        description: `Name, URL and defaults for everyone in ${saved.name}.`,
        canEdit: access.canEdit,
      })}
    >
      <ReadOnlyArea canEdit={access.canEdit}>
        <SettingsSection title="Workspace">
          <SettingsCard
            footer={
              <SaveFooter
                dirty={dirty && !saving}
                onDiscard={() => setDraft(saved)}
                onSave={() => void handleSave()}
              />
            }
          >
            <SettingsRow
              title="Workspace logo"
              description="Logo upload isn't available yet; the first letter of the name is used."
              media={<WorkspaceLogoTile name={saved.name} />}
              control={
                <Button variant="outline" size="sm" disabled>
                  Upload
                </Button>
              }
            />
            <SettingsRow
              title="Name"
              description="Visible to members and on shared threads."
              control={
                <Input
                  aria-label="Workspace name"
                  className="w-64"
                  value={draft.name}
                  onChange={(event) => handleChange({ name: event.target.value })}
                />
              }
            />
            <SettingsRow
              title="Slug"
              description="Changing the slug breaks existing links to this workspace."
              control={
                <InputGroup className="w-64">
                  <InputGroupAddon>
                    <InputGroupText className="font-mono text-xs">atlas.dev/</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Workspace slug"
                    className="pl-0.5! font-mono text-xs md:text-xs"
                    value={draft.slug}
                    onChange={(event) => handleChange({ slug: sanitizeSlug(event.target.value) })}
                  />
                </InputGroup>
              }
            />
            <SettingsRow
              title="Default sandbox region"
              description="Where new sandboxes start unless a project overrides it."
              control={
                <WorkspaceSelect
                  label="Default sandbox region"
                  value={draft.region}
                  options={REGION_OPTIONS}
                  onChange={(region) => handleChange({ region })}
                />
              }
            />
            <SettingsRow
              title="Default model for new members"
              description="Members can change this in their own Models & Effort settings."
              control={
                <WorkspaceSelect
                  label="Default model for new members"
                  value={draft.model}
                  options={DEFAULT_MODEL_OPTIONS}
                  onChange={(model) => handleChange({ model })}
                />
              }
            />
          </SettingsCard>
        </SettingsSection>
      </ReadOnlyArea>
      <WorkspaceDetailsCard details={detailsOf(details)} />
      <WorkspaceDangerZone
        name={saved.name}
        isOwner={access.role === EWorkspaceRole.Owner}
        deleting={deleting}
        onDelete={() => void handleDelete()}
      />
    </SettingsPage>
  )
}

function LoadedGeneral({ access }: { access: WorkspaceAccess }) {
  const router = useRouter()
  const { query, save, destroy } = useGeneralSettings(access.organization.id)

  const handleSave = (args: { saved: GeneralDraft; draft: GeneralDraft }) => {
    const invalid = validateGeneralDraft(args.draft)
    if (invalid !== null) {
      toast.error(invalid)
      return Promise.resolve(false)
    }
    return runAction({
      work: () => save(planGeneralSave(args)),
      success: 'Workspace settings saved',
    })
  }
  const handleDelete = async () => {
    const ok = await runAction({ work: destroy, success: 'Workspace deleted' })
    if (ok) router.push('/')
    return ok
  }

  return (
    <QueryGate query={query} label="workspace settings" wrap={pageWrapOf({ title: TITLE })}>
      {({ details, saved }) => (
        <GeneralForm
          access={access}
          saved={saved}
          details={details}
          onSave={(draft) => handleSave({ saved, draft })}
          onDelete={handleDelete}
        />
      )}
    </QueryGate>
  )
}

export function WorkspaceGeneralPage() {
  return (
    <WorkspaceGate title={TITLE}>{(access) => <LoadedGeneral access={access} />}</WorkspaceGate>
  )
}
