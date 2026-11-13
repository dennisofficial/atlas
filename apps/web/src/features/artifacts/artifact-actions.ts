'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { ARTIFACTS_KEY, artifactKeyOf, deleteArtifact } from './artifacts-api'
import { ARTIFACTS_PATH } from './artifacts-path'

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function useArtifactActions(args: { ref: string }) {
  const router = useRouter()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteArtifact(args.ref)
      client.removeQueries({ queryKey: [artifactKeyOf(args.ref)] })
      await client.invalidateQueries({ queryKey: [ARTIFACTS_KEY], refetchType: 'all' })
      toast.success('Artifact deleted')
      router.push(ARTIFACTS_PATH)
    } catch (error) {
      toast.error(messageOf(error, 'Could not delete this artifact'))
      setBusy(false)
    }
  }

  return { busy, handleDelete }
}
