'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@dltech/atlas-ui/components/input-group'

import {
  DEFAULT_MODEL_OPTIONS,
  REGION_OPTIONS,
  WORKSPACE_MEMBERS,
  WORKSPACE_PROFILE,
  EWorkspaceRole,
} from '../fixtures/settings-workspace'
import { WorkspaceDangerZone } from '../parts/workspace-danger-zone'
import { WorkspaceDetailsCard } from '../parts/workspace-details-card'
import { WorkspaceLogoTile } from '../parts/workspace-logo-tile'
import { WorkspaceSelect } from '../parts/workspace-select'
import {
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../settings-layout'

type GeneralDraft = { name: string; slug: string; region: string; model: string }

const OWNER = WORKSPACE_MEMBERS.find((member) => member.role === EWorkspaceRole.Owner)

function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
}

export function WorkspaceGeneralPage() {
  const [saved, setSaved] = useState<GeneralDraft>({
    name: WORKSPACE_PROFILE.name,
    slug: WORKSPACE_PROFILE.slug,
    region: WORKSPACE_PROFILE.region,
    model: WORKSPACE_PROFILE.model,
  })
  const [draft, setDraft] = useState(saved)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const handleChange = (patch: Partial<GeneralDraft>) => setDraft({ ...draft, ...patch })
  const handleSave = () => setSaved(draft)

  return (
    <SettingsPage
      title="General"
      description={`Name, URL and defaults for everyone in ${saved.name}.`}
    >
      <SettingsSection title="Workspace">
        <SettingsCard
          footer={
            <SaveFooter dirty={dirty} onDiscard={() => setDraft(saved)} onSave={handleSave} />
          }
        >
          <SettingsRow
            title="Workspace logo"
            description="Shown in the workspace switcher. Defaults to the first letter of the name."
            media={<WorkspaceLogoTile name={saved.name} />}
            control={
              <Button variant="outline" size="sm">
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
                className="w-64 max-w-full"
                value={draft.name}
                onChange={(event) => handleChange({ name: event.target.value })}
              />
            }
          />
          <SettingsRow
            title="Slug"
            description="Changing the slug breaks existing links to this workspace."
            control={
              <InputGroup className="w-64 max-w-full">
                <InputGroupAddon>
                  <InputGroupText className="font-mono text-xs">atlas.dev/</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Workspace slug"
                  className="font-mono text-xs md:text-xs"
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
      <WorkspaceDetailsCard
        details={{
          id: WORKSPACE_PROFILE.id,
          createdAt: WORKSPACE_PROFILE.createdAt,
          ownerName: OWNER?.name ?? '—',
          ownerInitials: OWNER?.initials ?? '—',
        }}
      />
      <WorkspaceDangerZone name={saved.name} />
    </SettingsPage>
  )
}
