'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { CLOUD_CAPABILITIES } from '@/lib/cloud-capabilities'
import { EQueryState } from '@/lib/use-cloud-query'

import { LoadFailed, LoadingBlocks } from '../data/workspace/query-gate'
import { runAction } from '../data/workspace/run-action'
import {
  requestBodyOf,
  statusLineOf,
  validateVercelDraft,
  type VercelDraft,
} from '../data/workspace/vercel-credential'
import { useVercelCredential } from '../data/workspace/vercel-credential-resource'
import { WorkspaceVercelCard } from './workspace-vercel-card'

function LiveVercelCard({ organizationId }: { organizationId: string }) {
  const { query, save, remove } = useVercelCredential(organizationId)
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
    <WorkspaceVercelCard
      key={`${view.configured}|${view.teamId}|${view.updatedAt}`}
      view={view}
      statusLine={statusLineOf({ view, now: fetchedAt })}
      saving={saving}
      onSave={(draft) => void handleSave(draft)}
      onRemove={() => void handleRemove()}
    />
  )
}

export function WorkspaceVercelCardSlot({
  organizationId,
  canEdit,
}: {
  organizationId: string
  canEdit: boolean
}) {
  if (!CLOUD_CAPABILITIES.workspaceVercelCredential) return <WorkspaceVercelCard disabled soon />
  if (!canEdit) return <WorkspaceVercelCard disabled />
  return <LiveVercelCard organizationId={organizationId} />
}
