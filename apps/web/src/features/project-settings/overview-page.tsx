'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowUpRightIcon,
  FolderGit2Icon,
  PlusIcon,
  XIcon,
} from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@dltech/atlas-ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { EShipBehavior, SHIP_BEHAVIORS } from './fixtures/project-settings'
import { useProjectContext } from './data/project-context'
import {
  draftsEqual,
  overviewDraftOf,
  saveBodyOf,
  type OverviewDraft,
  type ProjectIdentity,
} from './data/project-mapping'
import { DangerZone } from './overview-danger-zone'
import {
  ERowLayout,
  MonogramTile,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from './settings-layout'

const SHIP_ITEMS = SHIP_BEHAVIORS.map(({ value, label }) => ({ value, label }))

function isShipBehavior(value: unknown): value is EShipBehavior {
  return Object.values(EShipBehavior).some((behavior) => behavior === value)
}

function RepositoryControls({ identity }: { identity: ProjectIdentity }) {
  if (identity.repo === null) {
    return <span className="text-sm text-muted-foreground">No repository connected</span>
  }
  return (
    <>
      <a
        href={`https://github.com/${identity.repo}`}
        target="_blank"
        rel="noreferrer"
        className="mr-auto inline-flex min-w-0 items-center gap-1 font-mono text-sm text-foreground underline-offset-4 hover:underline sm:mr-0"
      >
        <span className="truncate">{identity.repo}</span>
        <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </>
  )
}

function AdditionalRepositories({
  repositories,
  onChange,
}: {
  repositories: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const handleRemove = (index: number) => {
    onChange(repositories.filter((_, position) => position !== index))
  }
  const handleEdit = ({ index, value }: { index: number; value: string }) => {
    onChange(repositories.map((repo, position) => (position === index ? value : repo)))
  }
  return (
    <>
      {repositories.map((repo, index) => (
        <InputGroup key={index}>
          <InputGroupAddon>
            <FolderGit2Icon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`Additional repository ${index + 1}`}
            className="font-mono"
            placeholder="owner/repo"
            value={repo}
            onChange={(event) => handleEdit({ index, value: event.target.value })}
          />
          <InputGroupAddon align="inline-end">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${repo || 'repository'}`}
              onClick={() => handleRemove(index)}
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...repositories, ''])}
      >
        <PlusIcon data-icon="inline-start" />
        Add repository
      </Button>
    </>
  )
}

export function OverviewPage() {
  const { project, identity, save } = useProjectContext()
  const saved = overviewDraftOf(project)
  const [draft, setDraft] = useState<OverviewDraft>(saved)
  const [saving, setSaving] = useState(false)
  const dirty = !draftsEqual({ left: draft, right: saved })
  const invalid = draft.name.trim() === ''

  const update = (patch: Partial<OverviewDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))

  const handleShipChange = (value: unknown) => {
    if (isShipBehavior(value)) update({ shipBehavior: value })
  }

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

  const shipDescription = SHIP_BEHAVIORS.find(
    (item) => item.value === draft.shipBehavior,
  )?.description

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
          <SettingsRow title="Project icon" description="Icons aren't supported yet.">
            <MonogramTile label={draft.name || identity.name} />
            <Button variant="outline" size="sm" disabled>
              Set icon
            </Button>
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
          <SettingsRow title="Ship behavior" htmlFor="project-ship" description={shipDescription}>
            <Select items={SHIP_ITEMS} value={draft.shipBehavior} onValueChange={handleShipChange}>
              <SelectTrigger id="project-ship" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIP_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            title="Additional repositories"
            description="Cloned next to the main repository, for threads that span repos."
            layout={ERowLayout.Stacked}
          >
            <AdditionalRepositories
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
