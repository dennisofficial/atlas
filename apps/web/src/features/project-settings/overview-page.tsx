'use client'

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

import { ProjectAvatar } from '@/features/projects/project-avatar'

import { useProjectContext } from './data/project-context'
import {
  draftsEqual,
  overviewDraftOf,
  saveBodyOf,
  type OverviewDraft,
} from './data/project-mapping'
import { GroupPicker } from './group-picker'
import { DangerZone } from './overview-danger-zone'
import { AdditionalRepositories, RepositoryControls } from './overview-repositories'
import {
  ERowLayout,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from './settings-layout'
import { ShipRow } from './ship-row'

export function OverviewPage() {
  const { project, identity, save, reload } = useProjectContext()
  const saved = overviewDraftOf(project)
  const [draft, setDraft] = useState<OverviewDraft>(saved)
  const [saving, setSaving] = useState(false)
  const dirty = !draftsEqual({ left: draft, right: saved })
  const invalid = draft.name.trim() === ''

  const update = (patch: Partial<OverviewDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await save(saveBodyOf({ project, draft }))
      toast.success('Project saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingsSection
        title="Overview"
        description="How Atlas names, clones, and ships this project."
      >
        <SettingsCard
          footer={
            <>
              <UnsavedHint visible={dirty} />
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
                  Discard
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={!dirty || saving || invalid}
                onClick={() => void handleSave()}
              >
                Save
              </Button>
            </>
          }
        >
          <SettingsRow
            title="Name"
            htmlFor="project-name"
            description="Shown in the sidebar and on threads."
          >
            <InputGroup>
              {identity.owner === '' ? null : (
                <InputGroupAddon>
                  <InputGroupText className="font-mono">{identity.owner} /</InputGroupText>
                </InputGroupAddon>
              )}
              <InputGroupInput
                id="project-name"
                aria-invalid={invalid || undefined}
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </InputGroup>
          </SettingsRow>
          <SettingsRow
            title="Project icon"
            description={
              identity.repo === null
                ? 'The first letter of the project name.'
                : `The GitHub avatar of ${identity.owner}.`
            }
          >
            <ProjectAvatar name={draft.name || identity.name} repo={identity.repo} />
          </SettingsRow>
          <SettingsRow title="Description" htmlFor="project-description">
            <Input
              id="project-description"
              placeholder="What this project is for"
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </SettingsRow>
          <SettingsRow
            title="GitHub repository"
            description="Threads clone this repository into their sandbox."
          >
            <RepositoryControls identity={identity} />
          </SettingsRow>
          <SettingsRow
            title="Group"
            description="Projects in a group inherit its secrets, files, settings, skills and MCP servers."
          >
            <GroupPicker projectId={project.id} groupId={project.groupId} onAssigned={reload} />
          </SettingsRow>
          <SettingsRow
            title="Base branch"
            htmlFor="project-base-branch"
            description="New threads branch from here, and pull requests target it."
          >
            <Input
              id="project-base-branch"
              className="font-mono"
              placeholder="Repository default branch"
              value={draft.baseBranch}
              onChange={(event) => update({ baseBranch: event.target.value })}
            />
          </SettingsRow>
          <ShipRow
            value={draft.shipBehavior}
            onChange={(shipBehavior) => update({ shipBehavior })}
          />
          <SettingsRow
            title="Additional repositories"
            description="Cloned next to the main repository, for threads that span repos."
            layout={ERowLayout.Stacked}
          >
            <AdditionalRepositories
              mainRepository={identity.repo}
              repositories={draft.additionalRepositories}
              onChange={(next) => update({ additionalRepositories: next })}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <DangerZone projectSlug={identity.slug} />
    </>
  )
}
