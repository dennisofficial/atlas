'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@dltech/atlas-ui/components/collapsible'
import { Input } from '@dltech/atlas-ui/components/input'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { EVercelCredentialKind, EVercelPlan } from '@dltech/atlas-wire/web'

import { AVAILABLE_SOON } from '@/lib/cloud-capabilities'

import {
  canSaveVercelDraft,
  type VercelCredentialView,
  type VercelDraft,
} from '../data/shared/vercel-credential'
import { SettingsCard, SettingsRow } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'

export type VercelCardCopy = {
  description: string
  removeDescription: string
}

export const PERSONAL_VERCEL_COPY: VercelCardCopy = {
  description:
    'Atlas Cloud creates your sandboxes in this Vercel team and project with this token.',
  removeDescription: "New sandboxes won't start until a token is saved again.",
}

export const EMPTY_VERCEL_VIEW: VercelCredentialView = {
  configured: false,
  kind: EVercelCredentialKind.Token,
  teamId: '',
  vercelProjectId: '',
  plan: EVercelPlan.Unknown,
  planCheckedAt: null,
  needsReconnect: false,
  oauthConfigured: false,
  updatedAt: null,
}

export const PLAN_BADGE_LABEL: Record<EVercelPlan, string> = {
  [EVercelPlan.Hobby]: 'Hobby',
  [EVercelPlan.Pro]: 'Pro',
  [EVercelPlan.Enterprise]: 'Enterprise',
  [EVercelPlan.Unknown]: 'Plan unknown',
}

function StatusLine({ tone, text }: { tone: 'ok' | 'warn' | 'off'; text: string }) {
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          tone === 'ok' && 'bg-success',
          tone === 'warn' && 'bg-warning',
          tone === 'off' && 'bg-muted-foreground/40',
        )}
      />
      {text}
    </span>
  )
}

export type VercelCardActions = {
  onConnect?: () => void
  onRefreshPlan?: () => void
  connecting?: boolean
  refreshingPlan?: boolean
}

function TokenFields({
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
  const tokenLocked = view.configured && view.kind === EVercelCredentialKind.Token && !replacing
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

  return (
    <>
      <SettingsRow
        title={<label htmlFor={teamId}>Team ID</label>}
        description="The Vercel team or account the sandboxes belong to."
        control={
          <Input
            id={teamId}
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
        title={<label htmlFor={projectId}>Project ID</label>}
        description="The Vercel project the sandboxes are created in."
        control={
          <Input
            id={projectId}
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
        title={<label htmlFor={tokenId}>Token</label>}
        description={
          view.configured && view.kind === EVercelCredentialKind.Token
            ? 'Write-only. Leave it blank to keep the saved token.'
            : 'Required. Write-only, and never shown again once saved.'
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
              onChange={(event) => setDraft({ ...draft, token: event.target.value })}
            />
            {view.configured && view.kind === EVercelCredentialKind.Token && !disabled ? (
              <Button variant="outline" size="sm" onClick={replacing ? handleKeep : handleReplace}>
                {replacing ? 'Keep saved token' : 'Replace token'}
              </Button>
            ) : null}
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

export function VercelCredentialCard({
  copy = PERSONAL_VERCEL_COPY,
  view = EMPTY_VERCEL_VIEW,
  statusLine,
  disabled = false,
  soon = false,
  saving = false,
  actions = {},
  onSave,
  onRemove,
}: {
  copy?: VercelCardCopy
  view?: VercelCredentialView
  statusLine?: string
  disabled?: boolean
  soon?: boolean
  saving?: boolean
  actions?: VercelCardActions
  onSave?: (draft: VercelDraft) => void
  onRemove?: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const oauth = view.kind === EVercelCredentialKind.Oauth

  const handleRemove = () => {
    setConfirmOpen(false)
    onRemove?.()
  }

  const defaultStatus = !view.configured
    ? { tone: 'off' as const, text: 'Not configured' }
    : view.needsReconnect
      ? { tone: 'warn' as const, text: 'Connection expired — reconnect Vercel' }
      : {
          tone: 'ok' as const,
          text: oauth ? 'Connected via Vercel' : 'Connected via access token',
        }
  const status =
    statusLine === undefined ? defaultStatus : { tone: defaultStatus.tone, text: statusLine }

  return (
    <>
      <SettingsCard
        footer={
          view.configured && !disabled ? (
            <Button
              variant="destructive"
              size="sm"
              className="mr-auto"
              disabled={saving}
              onClick={() => setConfirmOpen(true)}
            >
              {oauth ? 'Disconnect' : 'Remove'}
            </Button>
          ) : null
        }
      >
        <SettingsRow
          media={<BrandMark brand={EBrand.Vercel} />}
          title={
            <>
              Vercel
              {soon ? <Badge variant="secondary">{AVAILABLE_SOON}</Badge> : null}
              {view.configured ? (
                <Badge variant="outline">{PLAN_BADGE_LABEL[view.plan]}</Badge>
              ) : null}
            </>
          }
          description={copy.description}
          control={<StatusLine tone={status.tone} text={status.text} />}
        />
        {view.oauthConfigured && (!view.configured || view.needsReconnect) && !disabled ? (
          <SettingsRow
            title="Connect Vercel"
            description="Sign in with Vercel — Atlas reads the team, its projects and plan for you."
            control={
              <Button size="sm" disabled={actions.connecting} onClick={actions.onConnect}>
                {actions.connecting
                  ? 'Redirecting…'
                  : view.needsReconnect
                    ? 'Reconnect Vercel'
                    : 'Connect Vercel'}
              </Button>
            }
          />
        ) : null}
        {oauth && view.configured ? (
          <SettingsRow
            title={<span className="font-mono text-xs md:text-xs">{view.teamId}</span>}
            description={
              view.vercelProjectId === ''
                ? 'Choose the Vercel project the sandboxes are created in.'
                : `Project ${view.vercelProjectId}`
            }
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={actions.refreshingPlan}
                onClick={actions.onRefreshPlan}
              >
                {actions.refreshingPlan ? 'Refreshing…' : 'Refresh plan'}
              </Button>
            }
          />
        ) : null}
        {!oauth && !disabled ? (
          <Collapsible>
            <SettingsRow
              title={
                <CollapsibleTrigger className="text-sm font-medium underline-offset-4 hover:underline">
                  Use an access token instead
                </CollapsibleTrigger>
              }
              description="A pasted token works the same; it just never tells Atlas your plan caps on its own."
            />
            <CollapsibleContent>
              <TokenFields view={view} disabled={disabled} saving={saving} onSave={onSave} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </SettingsCard>
      <LibraryConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={oauth ? 'Disconnect Vercel?' : 'Remove the Vercel credential?'}
        description={copy.removeDescription}
        confirmLabel={oauth ? 'Disconnect' : 'Remove'}
        onConfirm={handleRemove}
      />
    </>
  )
}
