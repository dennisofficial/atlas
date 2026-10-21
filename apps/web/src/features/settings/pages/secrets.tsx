'use client'

import { useMemo } from 'react'

import type { SecretDetail } from '@dltech/atlas-wire/web'

import { useSessionUser } from '../session/use-session-identity'
import { initialsOf } from '../session/initials'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { QueryPage } from '../data/personal/query-boundary'
import { fetchSecretDetails } from '../data/personal/secrets-api'
import { useSecretsStore } from '../data/personal/use-secrets-store'
import { ELibraryScope, type LibraryMember } from '../fixtures/settings-library'
import { SecretsView } from '../parts/library-secrets-view'
import { Mono } from '../settings-layout'

const TITLE = 'Secrets & Env Vars'

const DESCRIPTION = (
  <>
    Values injected into your sandboxes. Project values override workspace values, and your
    personal values override both. Manage them from the terminal with{' '}
    <Mono className="rounded bg-muted px-1.5 py-0.5">atlas secrets</Mono>.
  </>
)

export function SecretsPage() {
  const query = useCloudQuery({ key: 'personal-secrets', load: fetchSecretDetails })
  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION}>
      {(details) => <SecretsContent details={details} reload={query.reload} />}
    </QueryPage>
  )
}

function SecretsContent({ details, reload }: { details: SecretDetail[]; reload: () => void }) {
  const { user } = useSessionUser()
  const currentMember = useMemo<LibraryMember>(() => {
    const name = user?.name ?? 'You'
    return { name, initials: initialsOf(name) }
  }, [user])
  const store = useSecretsStore({ details, currentMember, reload })
  return (
    <SecretsView
      scope={ELibraryScope.Personal}
      description={DESCRIPTION}
      sectionDescription="Only visible to you."
      store={store}
    />
  )
}
