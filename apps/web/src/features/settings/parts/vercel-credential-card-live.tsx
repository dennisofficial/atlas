'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { CLOUD_CAPABILITIES } from '@/lib/cloud-capabilities'
import { EQueryState } from '@/lib/use-cloud-query'

import { useUserVercelCredential } from '../data/user/vercel-credential-resource'
import { LoadFailed, LoadingBlocks } from '../data/shared/query-gate'
import { runAction } from '../data/shared/run-action'
import {
  requestBodyOf,
  statusLineOf,
  validateVercelDraft,
  type VercelDraft,
} from '../data/shared/vercel-credential'
import type { VercelCredentialResource } from '../data/shared/vercel-credential-resource'
import {
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

  if (query.state === EQueryState.Loading) return <LoadingBlocks label="the Vercel credential" />
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
    await runAction({ work: remove, success: 'Vercel credential removed' })
    setSaving(false)
  }

  return (
    <VercelCredentialCard
      key={`${view.configured}|${view.teamId}|${view.vercelProjectId}|${view.updatedAt}`}
      copy={copy}
      view={view}
      statusLine={statusLineOf({ view, now: fetchedAt })}
      saving={saving}
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
    return <VercelCredentialCard copy={PERSONAL_VERCEL_COPY} disabled soon />
  }
  return <UserLiveCard />
}
