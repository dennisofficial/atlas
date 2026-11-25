'use client'

import { useMemo } from 'react'

import { EAccessScope } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import {
  AccessGrantsContent,
  AccessGrantsSkeleton,
} from '@/features/settings/parts/access/access-grants-content'
import { useAccessGrants } from '@/features/settings/parts/access/use-access-grants'

import { useProjectContext } from './data/project-context'
import { useProjectFileMounts } from './data/use-project-file-mounts'
import { useProjectSecrets } from './data/use-project-secrets'
import { SettingsSection } from './settings-layout'

const TITLE = 'Access'

const DESCRIPTION =
  'Tell the agent what each secret and file gives it access to. Atlas sends this to every session.'

export function AccessPage() {
  const { projectId } = useProjectContext()
  const scope = useMemo(() => ({ kind: EAccessScope.Project, projectId }) as const, [projectId])
  const grants = useAccessGrants(scope)
  const secrets = useProjectSecrets(projectId)
  const mounts = useProjectFileMounts(projectId)
  const secretNames = secrets.query.data?.secrets.map((secret) => secret.name) ?? []
  const filePaths = mounts.query.data?.mounts.map((mount) => mount.path) ?? []

  return (
    <SettingsSection title={TITLE} description={DESCRIPTION}>
      <QueryGate query={grants.query} label="access grants" skeleton={<AccessGrantsSkeleton />}>
        {(snapshot) => (
          <AccessGrantsContent
            grants={snapshot.grants}
            secretNames={secretNames}
            filePaths={filePaths}
            onSave={grants.save}
            onRemove={grants.remove}
          />
        )}
      </QueryGate>
    </SettingsSection>
  )
}
