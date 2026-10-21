'use client'

import { useCallback, useMemo } from 'react'

import { ENV_NAME_PATTERN, type SecretDetail } from '@dltech/atlas-wire/web'

import type { LibraryMember } from '../../fixtures/settings-library'
import type { SecretEntry } from '../../parts/library-secret-dialogs'
import type { SecretsStore } from '../../parts/secrets-store'
import { deleteSecret, saveSecretEntry, toLibrarySecret } from './secrets-api'

const INVALID_NAME =
  'Names start with a letter or underscore and use only letters, digits and underscores.'

export function useSecretsStore(args: {
  details: SecretDetail[]
  currentMember: LibraryMember
  reload: () => void
}): SecretsStore {
  const { details, currentMember, reload } = args
  const secrets = useMemo(
    () => details.map((detail) => toLibrarySecret({ detail, addedBy: currentMember })),
    [details, currentMember],
  )
  const save = useCallback(
    async (entry: SecretEntry) => {
      if (!ENV_NAME_PATTERN.test(entry.key)) throw new Error(INVALID_NAME)
      await saveSecretEntry({ entry, secrets })
      reload()
    },
    [secrets, reload],
  )
  const remove = useCallback(
    async (key: string) => {
      await deleteSecret(key)
      reload()
    },
    [reload],
  )
  return { secrets, save, remove }
}
