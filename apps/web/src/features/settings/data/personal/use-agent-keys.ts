'use client'

import { useCallback } from 'react'

import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { ESecretKind } from '../../fixtures/settings-library'
import type { KeyEntry } from '../../parts/agent-key-row'
import { fetchSecretDetails, putSecret } from './secrets-api'
import { useSaveAction } from './use-save-action'

const loadSecretNames = async (): Promise<ReadonlySet<string>> =>
  new Set((await fetchSecretDetails()).map((secret) => secret.name))

export function useAgentKeys(): {
  savedNames: ReadonlySet<string> | null
  handleSaveKey: (entry: KeyEntry) => Promise<boolean>
} {
  const names = useCloudQuery({ key: 'agent-key-names', load: loadSecretNames })
  const { run } = useSaveAction()
  const { reload } = names
  const handleSaveKey = useCallback(
    async (entry: KeyEntry) => {
      const done = await run({
        work: () => putSecret({ name: entry.name, value: entry.value, kind: ESecretKind.Secret }),
        success: 'Key saved',
      })
      if (done) reload()
      return done
    },
    [run, reload],
  )
  return {
    savedNames: names.state === EQueryState.Ready ? names.data : null,
    handleSaveKey,
  }
}
