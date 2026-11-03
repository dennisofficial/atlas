'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { EVercelConnectStartOutcome } from '@dltech/atlas-wire/web'

import { CLOUD_CAPABILITIES } from '@/lib/cloud-capabilities'
import { api, cloudCall } from '@/lib/api-client'
import { EQueryState } from '@/lib/use-cloud-query'

import { VercelCardSkeleton } from '../skeletons/table-skeletons'
import { useUserVercelCredential } from '../data/user/vercel-credential-resource'
import { LoadFailed, LoadingRegion } from '../data/shared/query-gate'
import { runAction } from '../data/shared/run-action'
import {
  requestBodyOf,
  statusLineOf,
  validateVercelDraft,
  type VercelDraft,
} from '../data/shared/vercel-credential'
import type { VercelDiscovery, VercelDiscoverFn } from '../data/shared/vercel-discovery'
import type { VercelCredentialResource } from '../data/shared/vercel-credential-resource'
import {
  EMPTY_VERCEL_VIEW,
  PERSONAL_VERCEL_COPY,
  VercelCredentialCard,
  type VercelCardCopy,
} from './vercel-credential-card'

function LiveVercelCard({
  resource,
  copy,
}: {
  resource: VercelCredentialResource
  copy: VercelCardCopy
}) {
  const { query, save, remove } = resource
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [refreshingPlan, setRefreshingPlan] = useState(false)

  if (query.state === EQueryState.Loading) {
    return (
      <LoadingRegion label="the Vercel credential">
        <VercelCardSkeleton />
      </LoadingRegion>
    )
  }
  if (query.state === EQueryState.Failed) {
    return (
      <LoadFailed
        label="the Vercel credential"
        message={query.error.message}
        onRetry={query.reload}
      />
    )
  }
  const { view, fetchedAt } = query.data

  const handleSave = async (draft: VercelDraft) => {
    const invalid = validateVercelDraft({ view, draft })
    if (invalid !== null) {
      toast.error(invalid)
      return
    }
    setSaving(true)
    await runAction({
      work: () => save(requestBodyOf(draft)),
      success: 'Vercel credential saved',
    })
    setSaving(false)
  }
  const handleRemove = async () => {
    setSaving(true)
    await runAction({ work: remove, success: 'Vercel disconnected' })
    setSaving(false)
  }
  const handleConnect = async () => {
    setConnecting(true)
    let redirecting = false
    await runAction({
      work: async () => {
        const result = await cloudCall(api.userVercel.connectStart.mutate())
        if (result.outcome === EVercelConnectStartOutcome.Redirect) {
          redirecting = true
          window.location.assign(result.url)
          return
        }
        toast.info('Connecting with Vercel is not configured on this deployment yet')
      },
    })
    if (!redirecting) setConnecting(false)
  }
  const handleRefreshPlan = async () => {
    setRefreshingPlan(true)
    await runAction({
      work: async () => {
        await cloudCall(api.userVercel.refreshPlan.mutate())
        query.reload()
      },
      success: 'Vercel plan refreshed',
    })
    setRefreshingPlan(false)
  }

  const discover: VercelDiscoverFn = async (input) => {
    const result = (await cloudCall(
      api.userVercel.discover.mutate({ token: input.token, teamId: input.teamId }),
    )) as VercelDiscovery
    return result
  }

  return (
    <VercelCredentialCard
      key={`${view.configured}|${view.teamId}|${view.vercelProjectId}|${view.updatedAt}|${view.kind}`}
      copy={copy}
      view={view}
      statusLine={statusLineOf({ view, now: fetchedAt })}
      saving={saving}
      discover={discover}
      actions={{
        onConnect: () => void handleConnect(),
        onRefreshPlan: () => void handleRefreshPlan(),
        connecting,
        refreshingPlan,
      }}
      onSave={(draft) => void handleSave(draft)}
      onRemove={() => void handleRemove()}
    />
  )
}

function UserLiveCard() {
  return <LiveVercelCard resource={useUserVercelCredential()} copy={PERSONAL_VERCEL_COPY} />
}

export function UserVercelCardSlot() {
  if (!CLOUD_CAPABILITIES.userVercelCredential) {
    return (
      <VercelCredentialCard copy={PERSONAL_VERCEL_COPY} view={EMPTY_VERCEL_VIEW} disabled soon />
    )
  }
  return <UserLiveCard />
}
