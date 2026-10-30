'use client'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { revealSecret } from '@/features/settings/data/shared/resource-api'
import { runAction } from '@/features/settings/data/shared/run-action'
import type { SecretPair } from '@/features/settings/parts/env-secrets-dialogs'
import { EnvSecretsContent } from '@/features/settings/parts/env-secrets-table'

import { useProjectContext } from './data/project-context'
import { projectSecretRows } from './data/project-secrets'
import { useProjectSecrets } from './data/use-project-secrets'
import { SettingsSection } from './settings-layout'

export function SecretsPage() {
  const { projectId } = useProjectContext()
  const own = useProjectSecrets(projectId)

  const handleSave = (pairs: readonly SecretPair[]) =>
    runAction({
      work: async () => {
        for (const pair of pairs) {
          await own.save({ name: pair.name, value: pair.value })
        }
      },
      success:
        pairs.length === 1
          ? `Saved ${pairs[0]?.name ?? 'secret'}`
          : `Saved ${pairs.length} secrets`,
    })
  const handleRemove = (name: string) => {
    void runAction({ work: () => own.remove(name), success: `Deleted ${name}` })
  }

  return (
    <SettingsSection
      title="Secrets & Env Vars"
      description="Order of precedence: default, then personal, then project. The project value wins. Every shell and service in a cloud thread gets them as environment variables."
    >
      <QueryGate query={own.query} label="project secrets">
        {(snapshot) => {
          const rows = projectSecretRows({ secrets: snapshot.secrets, now: snapshot.fetchedAt })
          return (
            <EnvSecretsContent
              rows={rows}
              emptyDescription="Add API keys and config the agent needs to build, test, and run this project."
              dialogDescription="Available to every thread in this project as an environment variable."
              fetchValue={(name) => revealSecret({ projectId, name })}
              onSave={handleSave}
              onRemove={handleRemove}
            />
          )
        }}
      </QueryGate>
    </SettingsSection>
  )
}
