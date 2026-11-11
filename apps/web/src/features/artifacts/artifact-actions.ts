'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { rollbackArtifact, unpublishArtifact } from './artifacts-api'
import { ARTIFACTS_PATH } from './artifacts-path'

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function useArtifactActions(args: { slug: string; reload: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const handleRollback = async (version: number) => {
    setBusy(true)
    try {
      const result = await rollbackArtifact({ slug: args.slug, version })
      toast.success(`Now serving v${result.version}`)
      args.reload()
    } catch (error) {
      toast.error(messageOf(error, 'Could not roll back this artifact'))
    } finally {
      setBusy(false)
    }
  }

  const handleUnpublish = async () => {
    setBusy(true)
    try {
      await unpublishArtifact(args.slug)
      toast.success('Artifact unpublished')
      router.push(ARTIFACTS_PATH)
    } catch (error) {
      toast.error(messageOf(error, 'Could not unpublish this artifact'))
      setBusy(false)
    }
  }

  return { busy, handleRollback, handleUnpublish }
}
