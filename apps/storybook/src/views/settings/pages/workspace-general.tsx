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
  WORKSPACE_GENERAL_DEFAULTS,
} from '../../../fixtures/settings-workspace'
import { WorkspaceDetailsCard } from '../parts/workspace-details-card'
import { WorkspaceLogoTile } from '../parts/workspace-logo-tile'
import { WorkspaceSelect } from '../parts/workspace-select'
import {
  DangerZone,
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  type DangerAction,
} from '../settings-layout'
import { useDraft } from '../use-draft'

const DANGER_ACTIONS: DangerAction[] = [
  {
    title: 'Transfer ownership',
    description: 'Hand this workspace to another admin. You become an admin.',
    buttonLabel: 'Transfer ownership',
    confirmTitle: 'Transfer ownership of DL Tech?',
    confirmDescription:
      'The new owner controls members, secrets and deletion. You will keep admin access until they remove it.',
  },
  {
    title: 'Delete workspace',
    description: 'Permanently delete DL Tech, its members, secrets and paused sandboxes.',
    buttonLabel: 'Delete workspace',
    confirmTitle: 'Delete DL Tech?',
    confirmDescription:
      'This permanently deletes the workspace, every shared secret and all paused sandboxes. It cannot be undone.',
  },
]

function sanitizeSlug(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export function WorkspaceGeneralPage() {
  const draft = useDraft(WORKSPACE_GENERAL_DEFAULTS)
  const { value } = draft
  const handleChange = (patch: Partial<typeof value>) => draft.setValue({ ...value, ...patch })
  return (
    <SettingsPage title="General" description="Name, URL and defaults for everyone in DL Tech.">
      <SettingsSection title="Workspace">
        <SettingsCard
          footer={<SaveFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />}
        >
          <SettingsRow
            title="Workspace logo"
            description="Square image, at least 256×256. Shown in the switcher and tabs."
            media={<WorkspaceLogoTile present={value.hasLogo} />}
            control={
              <>
                <Button variant="outline" size="sm" onClick={() => handleChange({ hasLogo: true })}>
                  Upload
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!value.hasLogo}
                  onClick={() => handleChange({ hasLogo: false })}
                >
                  Remove
                </Button>
              </>
            }
          />
          <SettingsRow
            title="Name"
            description="Visible to members and on shared threads."
            control={
              <Input
                aria-label="Workspace name"
                className="w-64"
                value={value.name}
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
                  value={value.slug}
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
                value={value.region}
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
                value={value.model}
                options={DEFAULT_MODEL_OPTIONS}
                onChange={(model) => handleChange({ model })}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
      <WorkspaceDetailsCard />
      <DangerZone actions={DANGER_ACTIONS} />
    </SettingsPage>
  )
}
