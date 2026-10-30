'use client'

import { useCallback } from 'react'

import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import type { KeyEntry } from '../../parts/agent-key-row'
import { EKeyNoun } from './agent-keys'
import { fetchHarnessSecretNames, putHarnessSecret } from './harness-secrets-api'
import { useSaveAction } from './use-save-action'

export const loadSecretNames = async (): Promise<ReadonlySet<string>> =>
  new Set(await fetchHarnessSecretNames())

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
        work: () => putHarnessSecret({ name: entry.name, value: entry.value }),
        success: entry.noun === EKeyNoun.Url ? 'URL saved' : 'Key saved',
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
