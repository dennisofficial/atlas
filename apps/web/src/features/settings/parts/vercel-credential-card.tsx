'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { Input } from '@dltech/atlas-ui/components/input'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AVAILABLE_SOON } from '@/lib/cloud-capabilities'

import {
  canSaveVercelDraft,
  type VercelCredentialView,
  type VercelDraft,
} from '../data/workspace/vercel-credential'
import { SettingsCard, SettingsRow } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'

export type VercelCardCopy = {
  description: string
  removeDescription: string
}

export const WORKSPACE_VERCEL_COPY: VercelCardCopy = {
  description:
    "Atlas Cloud creates this workspace's sandboxes in this Vercel team and project with this token.",
  removeDescription: "New sandboxes for this workspace won't start until a token is saved again.",
}

export const PERSONAL_VERCEL_COPY: VercelCardCopy = {
  description:
    'Atlas Cloud creates the sandboxes for your personal projects, and for threads without a project, in this Vercel team and project with this token.',
  removeDescription:
    "New sandboxes for your personal projects and threads without a project won't start until a token is saved again.",
}

const EMPTY_VIEW: VercelCredentialView = {
  configured: false,
  teamId: '',
  vercelProjectId: '',
  updatedAt: null,
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
  copy = WORKSPACE_VERCEL_COPY,
  view = EMPTY_VIEW,
  statusLine,
  disabled = false,
  soon = false,
  saving = false,
  onSave,
  onRemove,
}: {
  copy?: VercelCardCopy
  view?: VercelCredentialView
  statusLine?: string
  disabled?: boolean
  soon?: boolean
  saving?: boolean
  onSave?: (draft: VercelDraft) => void
  onRemove?: () => void
}) {
  const teamId = useId()
  const projectId = useId()
  const tokenId = useId()
  const tokenRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<VercelDraft>({
    teamId: view.teamId,
    vercelProjectId: view.vercelProjectId,
    token: '',
  })
  const [replacing, setReplacing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const tokenLocked = view.configured && !replacing
  const savable = canSaveVercelDraft({ view, draft })

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
  const handleRemove = () => {
    setConfirmOpen(false)
    onRemove?.()
  }

  return (
    <>
      <SettingsCard
        footer={
          <>
            {view.configured && !disabled ? (
              <Button
                variant="destructive"
                size="sm"
                className="mr-auto"
                disabled={saving}
                onClick={() => setConfirmOpen(true)}
              >
                Remove
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={disabled || !savable || saving}
              onClick={() => onSave?.(draft)}
            >
              {saving ? 'Saving…' : 'Save'}
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
          description={copy.description}
          control={
            statusLine === undefined ? null : (
              <StatusLine configured={view.configured} text={statusLine} />
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
          title={<label htmlFor={projectId}>Project ID</label>}
          description="The Vercel project the sandboxes are created in."
          control={
            <Input
              id={projectId}
              className="w-72 font-mono text-xs md:text-xs"
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
          title={<label htmlFor={tokenId}>Token</label>}
          description={
            view.configured
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
              {view.configured && !disabled ? (
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
        description={copy.removeDescription}
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </>
  )
}
