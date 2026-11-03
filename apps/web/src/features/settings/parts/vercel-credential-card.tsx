'use client'

import { useState } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@dltech/atlas-ui/components/collapsible'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { EVercelCredentialKind, EVercelPlan } from '@dltech/atlas-wire/web'

import { AVAILABLE_SOON } from '@/lib/cloud-capabilities'

import {
  PLAN_BADGE_LABEL,
  type VercelCredentialView,
  type VercelDraft,
} from '../data/shared/vercel-credential'
import type { VercelDiscoverFn } from '../data/shared/vercel-discovery'
import { SettingsCard, SettingsRow } from '../settings-layout'
import { LibraryConfirmDialog } from './library-confirm-dialog'
import { ManualIdFields } from './vercel-manual-id-fields'
import { TokenPickerRows } from './vercel-token-picker-fields'

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

export { PLAN_BADGE_LABEL }

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

export function VercelCredentialCard({
  copy = PERSONAL_VERCEL_COPY,
  view = EMPTY_VERCEL_VIEW,
  statusLine,
  disabled = false,
  soon = false,
  saving = false,
  actions = {},
  discover,
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
  discover?: VercelDiscoverFn
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
          <>
            <TokenPickerRows
              view={view}
              disabled={disabled}
              saving={saving}
              discover={discover}
              onSave={onSave}
            />
            <Collapsible>
              <SettingsRow
                title={
                  <CollapsibleTrigger className="text-sm font-medium underline-offset-4 hover:underline">
                    Enter IDs manually
                  </CollapsibleTrigger>
                }
                description="Type the team and project IDs by hand instead of picking them from the token."
              />
              <CollapsibleContent keepMounted={false}>
                <ManualIdFields view={view} disabled={disabled} saving={saving} onSave={onSave} />
              </CollapsibleContent>
            </Collapsible>
          </>
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
