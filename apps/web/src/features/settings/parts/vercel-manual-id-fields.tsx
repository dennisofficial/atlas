'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'

import type { VercelCredentialView, VercelDraft } from '../data/shared/vercel-credential'
import { SettingsRow } from '../settings-layout'

export function ManualIdFields({
  view,
  disabled,
  saving,
  onSave,
}: {
  view: VercelCredentialView
  disabled: boolean
  saving: boolean
  onSave?: (draft: VercelDraft) => void
}) {
  const [draft, setDraft] = useState<VercelDraft>({
    teamId: view.teamId,
    vercelProjectId: view.vercelProjectId,
    token: '',
  })
  const savable =
    draft.teamId.trim() !== '' &&
    draft.vercelProjectId.trim() !== '' &&
    (view.configured || draft.token.trim() !== '') &&
    (draft.teamId !== view.teamId ||
      draft.vercelProjectId !== view.vercelProjectId ||
      draft.token.trim() !== '')

  return (
    <>
      <SettingsRow
        title={<label htmlFor="vercel-manual-team">Team ID</label>}
        description="The Vercel team or account the sandboxes belong to."
        control={
          <Input
            id="vercel-manual-team"
            className="w-72 max-w-full font-mono text-xs md:text-xs"
            placeholder="team_…"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={draft.teamId}
            onChange={(event) => setDraft({ ...draft, teamId: event.target.value })}
          />
        }
      />
      <SettingsRow
        title={<label htmlFor="vercel-manual-project">Project ID</label>}
        description="The Vercel project the sandboxes are created in."
        control={
          <Input
            id="vercel-manual-project"
            className="w-72 max-w-full font-mono text-xs md:text-xs"
            placeholder="prj_…"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={draft.vercelProjectId}
            onChange={(event) => setDraft({ ...draft, vercelProjectId: event.target.value })}
          />
        }
      />
      <SettingsRow
        title={<label htmlFor="vercel-manual-token">Token</label>}
        description="Paste a Vercel access token. Write-only, and never shown again once saved."
        control={
          <>
            <Input
              id="vercel-manual-token"
              type="password"
              className="w-72 max-w-full"
              autoComplete="new-password"
              placeholder="Paste a Vercel access token"
              disabled={disabled}
              value={draft.token}
              onChange={(event) => setDraft({ ...draft, token: event.target.value })}
            />
            <Button
              size="sm"
              disabled={disabled || !savable || saving}
              onClick={() => onSave?.(draft)}
            >
              {saving ? 'Saving…' : 'Save token'}
            </Button>
          </>
        }
      />
    </>
  )
}
