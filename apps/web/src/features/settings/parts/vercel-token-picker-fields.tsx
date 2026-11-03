'use client'

import { useEffect, useId } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { EVercelCredentialKind } from '@dltech/atlas-wire/web'
import type { VercelProjectChoice, VercelTeamChoice } from '@dltech/atlas-wire/web'

import type { VercelCredentialView, VercelDraft } from '../data/shared/vercel-credential'
import {
  teamsLoaded,
  VERCEL_CREATE_TOKEN_URL,
  type VercelDiscoverFn,
  type VercelDiscoveryState,
} from '../data/shared/vercel-discovery'
import { SettingsRow } from '../settings-layout'
import { teamLabelOf, useTokenPickerState } from './vercel-token-picker-state'

export function teamControlOf({
  discovery,
  teams,
  draft,
  disabled,
  onChange,
}: {
  discovery: VercelDiscoveryState
  teams: VercelTeamChoice[]
  draft: VercelDraft
  disabled: boolean
  onChange: (teamId: string) => void
}): { content: React.ReactNode; disabled: boolean } {
  if (discovery.status === 'loading') {
    return { content: 'Finding your teams…', disabled: true }
  }
  if (discovery.status === 'failed') {
    return { content: `Could not read teams — ${discovery.message}`, disabled: true }
  }
  if (!teamsLoaded(discovery)) {
    return { content: 'Paste a token to load your teams', disabled: true }
  }
  const handleChange = (next: unknown) => {
    if (typeof next === 'string') onChange(next)
  }
  return {
    disabled,
    content: (
      <Select value={draft.teamId} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size="sm" className="w-72 max-w-full" aria-label="Vercel team">
          <SelectValue placeholder="Pick a team" />
        </SelectTrigger>
        <SelectContent>
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {teamLabelOf(team)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  }
}

export function projectControlOf({
  discovery,
  teams,
  projects,
  draft,
  disabled,
  onChange,
}: {
  discovery: VercelDiscoveryState
  teams: VercelTeamChoice[]
  projects: VercelProjectChoice[]
  draft: VercelDraft
  disabled: boolean
  onChange: (projectId: string) => void
}): { content: React.ReactNode; disabled: boolean } {
  if (discovery.status === 'loading') {
    return { content: 'Pick a team first', disabled: true }
  }
  if (projects.length === 0) {
    const noTeamChosen = draft.teamId === '' || !teams.some((team) => team.id === draft.teamId)
    return {
      content:
        teams.length === 0 || noTeamChosen ? 'Pick a team first' : 'This team has no projects',
      disabled: true,
    }
  }
  const handleChange = (next: unknown) => {
    if (typeof next === 'string') onChange(next)
  }
  return {
    disabled,
    content: (
      <Select value={draft.vercelProjectId} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size="sm" className="w-72 max-w-full" aria-label="Vercel project">
          <SelectValue placeholder="Pick a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  }
}

export function TokenPickerRows({
  view,
  disabled,
  saving,
  discover,
  onSave,
}: {
  view: VercelCredentialView
  disabled: boolean
  saving: boolean
  discover: VercelDiscoverFn | undefined
  onSave?: (draft: VercelDraft) => void
}) {
  const tokenId = useId()
  const state = useTokenPickerState({ view, discover })
  const { draft, setDraft, discovery, teams, projects, replacing, setReplacing, tokenRef } = state
  const tokenLocked = view.configured && view.kind === EVercelCredentialKind.Token && !replacing
  const dirty =
    draft.teamId !== view.teamId ||
    draft.vercelProjectId !== view.vercelProjectId ||
    draft.token.trim() !== ''
  const savable =
    dirty &&
    draft.teamId.trim() !== '' &&
    draft.vercelProjectId.trim() !== '' &&
    (view.configured || draft.token.trim() !== '')

  useEffect(() => {
    if (replacing) tokenRef.current?.focus()
  }, [replacing, tokenRef])

  const handleReplace = () => {
    setDraft({ ...draft, token: '' })
    setReplacing(true)
  }
  const handleKeep = () => {
    setDraft({ ...draft, token: '' })
    setReplacing(false)
  }
  const handleTokenChange = (token: string) => {
    setDraft({ ...draft, token })
  }
  const handleTeamChange = (teamId: string) => {
    setDraft({ ...draft, teamId, vercelProjectId: '' })
  }
  const handleProjectChange = (projectId: string) => {
    setDraft({ ...draft, vercelProjectId: projectId })
  }

  const teamControl = teamControlOf({
    discovery,
    teams,
    draft,
    disabled: disabled || tokenLocked,
    onChange: handleTeamChange,
  })
  const projectControl = projectControlOf({
    discovery,
    teams,
    projects,
    draft,
    disabled: disabled || tokenLocked,
    onChange: handleProjectChange,
  })

  return (
    <>
      <SettingsRow
        title={<label htmlFor={tokenId}>Token</label>}
        description={
          <>
            {view.configured && view.kind === EVercelCredentialKind.Token
              ? 'Write-only. Leave it blank to keep the saved token.'
              : 'Required. Write-only, and never shown again once saved.'}{' '}
            <a
              href={VERCEL_CREATE_TOKEN_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Create a token
            </a>
          </>
        }
        control={
          <>
            <Input
              id={tokenId}
              ref={tokenRef}
              type="password"
              className="w-72 max-w-full"
              autoComplete="new-password"
              placeholder={tokenLocked ? 'Token saved and hidden' : 'Paste a Vercel access token'}
              disabled={disabled || tokenLocked}
              value={draft.token}
              onChange={(event) => handleTokenChange(event.target.value)}
            />
            {view.configured && view.kind === EVercelCredentialKind.Token && !disabled ? (
              <Button variant="outline" size="sm" onClick={replacing ? handleKeep : handleReplace}>
                {replacing ? 'Keep saved token' : 'Replace token'}
              </Button>
            ) : null}
          </>
        }
      />
      <SettingsRow
        title="Team"
        description="The Vercel team the sandboxes belong to."
        control={
          typeof teamControl.content === 'string' ? (
            <span
              className={
                discovery.status === 'failed'
                  ? 'text-sm text-destructive'
                  : 'text-sm text-muted-foreground'
              }
            >
              {teamControl.content}
            </span>
          ) : (
            teamControl.content
          )
        }
      />
      <SettingsRow
        title="Project"
        description="The Vercel project the sandboxes are created in."
        control={
          typeof projectControl.content === 'string' ? (
            <span className="text-sm text-muted-foreground">{projectControl.content}</span>
          ) : (
            projectControl.content
          )
        }
      />
      <SettingsRow
        title=""
        control={
          <Button
            size="sm"
            className="ml-auto"
            disabled={disabled || !savable || saving}
            onClick={() => onSave?.(draft)}
          >
            {saving ? 'Saving…' : 'Save credential'}
          </Button>
        }
      />
    </>
  )
}
