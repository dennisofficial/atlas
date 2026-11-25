'use client'

import { useMemo } from 'react'

import { EAccessScope } from '@dltech/atlas-wire/web'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { QueryPage } from '../data/personal/query-boundary'
import { fetchSecretSummaries } from '../data/personal/secrets-api'
import { AccessGrantsContent, AccessGrantsSkeleton } from '../parts/access/access-grants-content'
import { useAccessGrants } from '../parts/access/use-access-grants'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Access'

const DESCRIPTION =
  'Tell the agent what each secret and file gives it access to. Atlas sends this to every session.'

export function AccessPage() {
  const scope = useMemo(() => ({ kind: EAccessScope.Personal }) as const, [])
  const grants = useAccessGrants(scope)
  const secrets = useCloudQuery({ key: 'personal-secrets', load: fetchSecretSummaries })
  const secretNames = secrets.data?.map((secret) => secret.name) ?? []

  return (
    <QueryPage
      query={grants.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<AccessGrantsSkeleton />}
    >
      {(snapshot) => (
        <SettingsPage title={TITLE} description={DESCRIPTION}>
          <AccessGrantsContent
            grants={snapshot.grants}
            secretNames={secretNames}
            onSave={grants.save}
            onRemove={grants.remove}
          />
        </SettingsPage>
      )}
    </QueryPage>
  )
}
