'use client'

import { useCallback } from 'react'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { QueryPage } from '../data/personal/query-boundary'
import {
  deleteSecret,
  fetchSecretSummaries,
  putSecret,
  revealSecret,
  toEnvSecretRow,
} from '../data/personal/secrets-api'
import { useSaveAction } from '../data/personal/use-save-action'
import type { SecretPair } from '../parts/env-secrets-dialogs'
import { EnvSecretsContent } from '../parts/env-secrets-table'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Secrets & Env Vars'

const DESCRIPTION =
  'Every shell and service in your cloud threads gets these as environment variables. A project value with the same name wins.'

export function SecretsPage() {
  const query = useCloudQuery({ key: 'personal-secrets', load: fetchSecretSummaries })
  const { run } = useSaveAction()
  const { reload } = query

  const handleSave = useCallback(
    async (pairs: readonly SecretPair[]) => {
      const done = await run({
        work: async () => {
          for (const pair of pairs) await putSecret(pair)
        },
        success:
          pairs.length === 1
            ? `Saved ${pairs[0]?.name ?? 'secret'}`
            : `Saved ${pairs.length} secrets`,
      })
      reload()
      return done
    },
    [run, reload],
  )
  const handleRemove = useCallback(
    (name: string) => {
      void run({ work: () => deleteSecret(name), success: `Deleted ${name}` }).then(reload)
    },
    [run, reload],
  )

  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION}>
      {(summaries) => (
        <SettingsPage title={TITLE} description={DESCRIPTION}>
          <EnvSecretsContent
            rows={summaries.map((summary) => toEnvSecretRow({ summary }))}
            emptyDescription="Add API keys and config the agent needs in your cloud threads."
            dialogDescription="Available to every cloud thread you start as an environment variable."
            fetchValue={revealSecret}
            onSave={handleSave}
            onRemove={handleRemove}
          />
        </SettingsPage>
      )}
    </QueryPage>
  )
}
