'use client'

import { useState } from 'react'

import type { LibraryMember, LibrarySecret } from '../fixtures/settings-library'
import type { SecretEntry } from './library-secret-dialogs'

export type SecretsStore = {
  secrets: LibrarySecret[]
  save: (entry: SecretEntry) => Promise<void>
  remove: (key: string) => Promise<void>
}

export function useLocalSecretsStore(args: {
  initial: LibrarySecret[]
  currentMember: LibraryMember
}): SecretsStore {
  const [secrets, setSecrets] = useState(args.initial)
  const save = async (entry: SecretEntry) => {
    setSecrets((current) => {
      const existing = current.find((secret) => secret.key === entry.key)
      const next: LibrarySecret = existing
        ? {
            ...existing,
            updated: 'just now',
          }
        : {
            id: `new-${entry.key}`,
            key: entry.key,
            updated: 'just now',
            addedBy: args.currentMember,
          }
      return [next, ...current.filter((secret) => secret.key !== entry.key)]
    })
  }
  const remove = async (key: string) => {
    setSecrets((current) => current.filter((secret) => secret.key !== key))
  }
  return { secrets, save, remove }
}
