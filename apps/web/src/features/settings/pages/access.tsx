'use client'

import { useMemo } from 'react'

import { EAccessScope } from '@dltech/atlas-wire/web'

import { QueryPage } from '../data/personal/query-boundary'
import { AccessGrantsContent, AccessGrantsSkeleton } from '../parts/access/access-grants-content'
import { accessMemberApiOf } from '../parts/access/access-members-api'
import { useAccessGrants } from '../parts/access/use-access-grants'
import { useGrantMoveTargets } from '../parts/access/use-move-targets'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Access'

const DESCRIPTION =
  'Secrets and files for every project. A project value with the same name or path wins.'

const SECRET_DESCRIPTION = 'Available to every cloud thread you start as an environment variable.'

export function AccessPage() {
  const scope = useMemo(() => ({ kind: EAccessScope.Personal }) as const, [])
  const members = useMemo(() => accessMemberApiOf(scope), [scope])
  const { query, actions } = useAccessGrants({ scope, members })
  const { groups, projects } = useGrantMoveTargets()

  return (
    <QueryPage
      query={query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<AccessGrantsSkeleton />}
    >
      {(snapshot) => (
        <SettingsPage title={TITLE} description={DESCRIPTION}>
          <AccessGrantsContent
            grants={snapshot.grants}
            scope={scope}
            groups={groups}
            projects={projects}
            now={snapshot.fetchedAt}
            personal
            entries={[]}
            secretDescription={SECRET_DESCRIPTION}
            actions={actions}
          />
        </SettingsPage>
      )}
    </QueryPage>
  )
}
