import { ESecretKind } from '@dltech/atlas-wire/web'

import { relativeTimeOf } from '@/features/settings/data/workspace/relative-time'
import type { ListedSecret } from '@/features/settings/data/workspace/resource-api'

import { ESecretScope, type SecretRow } from '../fixtures/project-settings'

export type SecretPairInput = { name: string; value: string; kind: ESecretKind }

export function projectSecretRows({
  project,
  workspace,
  now,
}: {
  project: readonly ListedSecret[]
  workspace: readonly ListedSecret[]
  now: number
}): SecretRow[] {
  const workspaceNames = new Set(workspace.map((secret) => secret.name))
  const projectNames = new Set(project.map((secret) => secret.name))
  const own = project.map((secret) => ({
    name: secret.name,
    value: secret.value,
    scope: ESecretScope.Project,
    updated: relativeTimeOf({ iso: secret.updatedAt, now }),
    overridesWorkspace: workspaceNames.has(secret.name),
  }))
  const inherited = workspace
    .filter((secret) => !projectNames.has(secret.name))
    .map((secret) => ({
      name: secret.name,
      value: secret.value,
      scope: ESecretScope.Workspace,
      updated: relativeTimeOf({ iso: secret.updatedAt, now }),
    }))
  return [...own, ...inherited]
}
