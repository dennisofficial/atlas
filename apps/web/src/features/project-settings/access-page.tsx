'use client'

import { useMemo } from 'react'

import { EAccessScope } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import {
  AccessGrantsContent,
  AccessGrantsSkeleton,
} from '@/features/settings/parts/access/access-grants-content'
import { accessMemberApiOf } from '@/features/settings/parts/access/access-members-api'
import { useAccessGrants } from '@/features/settings/parts/access/use-access-grants'
import { EQueryState } from '@/lib/use-cloud-query'

import { useProjectContext } from './data/project-context'
import { useRepoTreeEntries } from './data/use-repo-tree'
import { SettingsSection } from './settings-layout'

const TITLE = 'Access'

const DESCRIPTION =
  'Tell the agent what each secret and file gives it access to. Atlas sends this to every session.'

const SECRET_DESCRIPTION = 'Available to every thread in this project as an environment variable.'

export function AccessPage() {
  const { projectId } = useProjectContext()
  const scope = useMemo(() => ({ kind: EAccessScope.Project, projectId }) as const, [projectId])
  const members = useMemo(() => accessMemberApiOf(scope), [scope])
  const { query, actions } = useAccessGrants({ scope, members })
  const tree = useRepoTreeEntries(projectId)
  const entries = tree.state === EQueryState.Ready ? tree.data : []

  return (
    <SettingsSection title={TITLE} description={DESCRIPTION}>
      <QueryGate query={query} label="access grants" skeleton={<AccessGrantsSkeleton />}>
        {(snapshot) => (
          <AccessGrantsContent
            grants={snapshot.grants}
            now={snapshot.fetchedAt}
            personal={false}
            entries={entries}
            secretDescription={SECRET_DESCRIPTION}
            actions={actions}
          />
        )}
      </QueryGate>
    </SettingsSection>
  )
}
