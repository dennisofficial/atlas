'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { unpublishArtifact } from './artifacts-api'
import { ARTIFACTS_PATH } from './artifacts-path'

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function useArtifactActions(args: { ref: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const handleUnpublish = async () => {
    setBusy(true)
    try {
      await unpublishArtifact(args.ref)
      toast.success('Artifact unpublished')
      router.push(ARTIFACTS_PATH)
    } catch (error) {
      toast.error(messageOf(error, 'Could not unpublish this artifact'))
      setBusy(false)
    }
  }

  return { busy, handleUnpublish }
}
