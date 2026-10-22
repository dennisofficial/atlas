import { useEffect, useId, useRef, useState } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { Input } from '@dltech/atlas-ui/components/input'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { SettingsCard, SettingsRow } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'

export type VercelCredentialView = {
  configured: boolean
  teamId: string
  updatedAt: string | null
}

export type VercelDraft = { teamId: string; token: string }

export const VERCEL_DESCRIPTION =
  "Atlas Cloud creates this workspace's sandboxes in your Vercel team with this token. Each project picks its Vercel project in Project → Sandbox."

const AVAILABLE_SOON = 'Available soon'
const EMPTY_VIEW: VercelCredentialView = { configured: false, teamId: '', updatedAt: null }

const canSave = ({ view, draft }: { view: VercelCredentialView; draft: VercelDraft }): boolean => {
  const teamId = draft.teamId.trim()
  const token = draft.token.trim()
  if (teamId === '') return false
  if (!view.configured && token === '') return false
  return teamId !== view.teamId || token !== ''
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

export function WorkspaceVercelCard({
  view = EMPTY_VIEW,
  statusLine,
  disabled = false,
  soon = false,
}: {
  view?: VercelCredentialView
  statusLine?: string
  disabled?: boolean
  soon?: boolean
}) {
  const teamId = useId()
  const tokenId = useId()
  const tokenRef = useRef<HTMLInputElement>(null)
  const [saved, setSaved] = useState(view)
  const [draft, setDraft] = useState<VercelDraft>({ teamId: view.teamId, token: '' })
  const [replacing, setReplacing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const tokenLocked = saved.configured && !replacing
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
    setSaved({ configured: true, teamId: draft.teamId.trim(), updatedAt: 'just now' })
    setDraft({ teamId: draft.teamId.trim(), token: '' })
    setReplacing(false)
  }
  const handleRemove = () => {
    setConfirmOpen(false)
    setSaved(EMPTY_VIEW)
    setDraft({ teamId: '', token: '' })
    setReplacing(false)
  }

  const shownStatus =
    saved === view
      ? statusLine
      : saved.configured
        ? 'Configured · updated just now'
        : 'Not configured'

  return (
    <>
      <SettingsCard
        footer={
          <>
            {saved.configured && !disabled ? (
              <Button
                variant="destructive"
                size="sm"
                className="mr-auto"
                onClick={() => setConfirmOpen(true)}
              >
                Remove
              </Button>
            ) : null}
            <Button size="sm" disabled={disabled || !savable} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow
          media={<BrandMark brand={EBrand.Vercel} />}
          title={
            <>
              Vercel
              {soon ? <Badge variant="secondary">{AVAILABLE_SOON}</Badge> : null}
            </>
          }
          description={VERCEL_DESCRIPTION}
          control={
            shownStatus === undefined ? null : (
              <StatusLine configured={saved.configured} text={shownStatus} />
            )
          }
        />
        <SettingsRow
          title={<label htmlFor={teamId}>Team ID</label>}
          description="The Vercel team or account the sandboxes belong to."
          control={
            <Input
              id={teamId}
              className="w-72 font-mono text-xs md:text-xs"
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
          title={<label htmlFor={tokenId}>Token</label>}
          description={
            saved.configured
              ? 'Write-only. Leave it blank to keep the saved token.'
              : 'Required. Write-only, and never shown again once saved.'
          }
          control={
            <>
              <Input
                id={tokenId}
                ref={tokenRef}
                type="password"
                className="w-72"
                autoComplete="new-password"
                placeholder={tokenLocked ? 'Token saved and hidden' : 'Paste a Vercel access token'}
                disabled={disabled || tokenLocked}
                value={draft.token}
                onChange={(event) => setDraft({ ...draft, token: event.target.value })}
              />
              {saved.configured && !disabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={replacing ? handleKeep : handleReplace}
                >
                  {replacing ? 'Keep saved token' : 'Replace token'}
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
        description="New sandboxes for this workspace won't start until a token is saved again."
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </>
  )
}
