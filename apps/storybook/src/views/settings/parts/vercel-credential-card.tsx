import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { Input } from '@dltech/atlas-ui/components/input'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { Mono, SettingsCard, SettingsRow } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'

export type VercelCredentialView = {
  configured: boolean
  tokenHint: string | null
  teamId: string
  vercelProjectId: string
  updatedAt: string | null
}

export type VercelDraft = { teamId: string; vercelProjectId: string; token: string }

const REMOVE_DESCRIPTION = "New sandboxes won't start until you save a token again."

const EMPTY_VIEW: VercelCredentialView = {
  configured: false,
  tokenHint: null,
  teamId: '',
  vercelProjectId: '',
  updatedAt: null,
}

const TOKEN_TAIL_LENGTH = 4
const TOKEN_PREFIX_PATTERN = /^([A-Za-z0-9]+)_/

const buildTokenHint = (token: string): string => {
  const tail = token.slice(-TOKEN_TAIL_LENGTH)
  const prefix = TOKEN_PREFIX_PATTERN.exec(token)?.[1]
  return prefix ? `${prefix}_…${tail}` : `••••${tail}`
}

const formatSavedDate = (iso: string | null): string | null => {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `Saved ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

const canSave = ({ view, draft }: { view: VercelCredentialView; draft: VercelDraft }): boolean => {
  const teamId = draft.teamId.trim()
  const vercelProjectId = draft.vercelProjectId.trim()
  const token = draft.token.trim()
  if (teamId === '' || vercelProjectId === '') return false
  if (!view.configured && token === '') return false
  return teamId !== view.teamId || vercelProjectId !== view.vercelProjectId || token !== ''
}

function StatusLine({ configured, text }: { configured: boolean; text: string }) {
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <span
        aria-hidden
        className={cn('size-2 rounded-full', configured ? 'bg-success' : 'bg-muted-foreground/40')}
      />
      {text}
    </span>
  )
}

export function VercelCredentialCard({
  view = EMPTY_VIEW,
  statusLine,
}: {
  view?: VercelCredentialView
  statusLine?: string
}) {
  const teamId = useId()
  const projectId = useId()
  const tokenId = useId()
  const tokenRef = useRef<HTMLInputElement>(null)
  const [saved, setSaved] = useState(view)
  const [draft, setDraft] = useState<VercelDraft>({
    teamId: view.teamId,
    vercelProjectId: view.vercelProjectId,
    token: '',
  })
  const [replacing, setReplacing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const showTokenInput = !saved.configured || replacing
  const savedDate = formatSavedDate(saved.updatedAt)
  const savable = canSave({ view: saved, draft })

  useEffect(() => {
    if (replacing) tokenRef.current?.focus()
  }, [replacing])

  const handleReplace = () => {
    setDraft({ ...draft, token: '' })
    setReplacing(true)
  }
  const handleKeep = () => {
    setDraft({ ...draft, token: '' })
    setReplacing(false)
  }
  const handleSave = () => {
    setSaved({
      configured: true,
      tokenHint: draft.token.trim() === '' ? saved.tokenHint : buildTokenHint(draft.token.trim()),
      teamId: draft.teamId.trim(),
      vercelProjectId: draft.vercelProjectId.trim(),
      updatedAt: new Date().toISOString(),
    })
    setDraft({
      teamId: draft.teamId.trim(),
      vercelProjectId: draft.vercelProjectId.trim(),
      token: '',
    })
    setReplacing(false)
  }
  const handleRemove = () => {
    setConfirmOpen(false)
    setSaved(EMPTY_VIEW)
    setDraft({ teamId: '', vercelProjectId: '', token: '' })
    setReplacing(false)
  }

  const fallbackStatus = saved.configured ? 'Configured' : 'Not configured'
  const shownStatus =
    saved === view
      ? (statusLine ?? fallbackStatus)
      : saved.configured
        ? 'Configured · updated just now'
        : fallbackStatus

  return (
    <>
      <SettingsCard
        footer={
          <>
            {saved.configured ? (
              <Button
                variant="destructive"
                size="sm"
                className="mr-auto"
                onClick={() => setConfirmOpen(true)}
              >
                Remove
              </Button>
            ) : null}
            <Button size="sm" disabled={!savable} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow
          media={<BrandMark brand={EBrand.Vercel} />}
          title={<StatusLine configured={saved.configured} text={shownStatus} />}
        />
        <SettingsRow
          title={<label htmlFor={teamId}>Team ID</label>}
          description="The team or account that owns the sandboxes."
          control={
            <Input
              id={teamId}
              className="w-72 font-mono text-xs md:text-xs"
              placeholder="team_…"
              autoComplete="off"
              spellCheck={false}
              value={draft.teamId}
              onChange={(event) => setDraft({ ...draft, teamId: event.target.value })}
            />
          }
        />
        <SettingsRow
          title={<label htmlFor={projectId}>Project ID</label>}
          description="The project sandboxes are created in."
          control={
            <Input
              id={projectId}
              className="w-72 font-mono text-xs md:text-xs"
              placeholder="prj_…"
              autoComplete="off"
              spellCheck={false}
              value={draft.vercelProjectId}
              onChange={(event) => setDraft({ ...draft, vercelProjectId: event.target.value })}
            />
          }
        />
        <SettingsRow
          title={<label htmlFor={tokenId}>Token</label>}
          description={
            saved.configured && saved.tokenHint ? (
              <span className="flex items-center gap-2">
                <Mono className="text-foreground">{saved.tokenHint}</Mono>
                {savedDate ? <span className="text-xs">{savedDate}</span> : null}
              </span>
            ) : (
              'Write-only. Not shown again after you save.'
            )
          }
          control={
            <>
              {showTokenInput ? (
                <Input
                  id={tokenId}
                  ref={tokenRef}
                  type="password"
                  className="w-72"
                  autoComplete="new-password"
                  placeholder="Paste a Vercel access token"
                  value={draft.token}
                  onChange={(event) => setDraft({ ...draft, token: event.target.value })}
                />
              ) : null}
              {saved.configured ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={replacing ? handleKeep : handleReplace}
                >
                  {replacing ? 'Cancel' : 'Replace'}
                </Button>
              ) : null}
            </>
          }
        />
      </SettingsCard>
      <LibraryConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove the Vercel credential?"
        description={REMOVE_DESCRIPTION}
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </>
  )
}
