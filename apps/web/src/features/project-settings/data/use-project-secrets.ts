'use client'

import { useSecretsResource } from '@/features/settings/data/shared/use-secrets-resource'

export const useProjectSecrets = (projectId: string) => useSecretsResource(projectId)
