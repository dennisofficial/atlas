import { createApiClient } from '@dltech/atlas-api-router'
import { skillUsageKeyOf } from '@dltech/atlas-client/settings'
import type { SkillScopeInput, SkillUsageReply } from '@dltech/atlas-wire/web'
import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { apiOrigin } from '../config'

type TUsageSnapshot = {
  key: string
  revision: unknown
  usage: ReadonlyMap<string, SkillUsageReply>
}

export const useSkillUsage = ({
  targets,
  revision,
}: {
  targets: readonly SkillScopeInput[]
  revision: unknown
}): ReadonlyMap<string, SkillUsageReply> => {
  const { token } = useAuth()
  const api = useMemo(
    () =>
      token === undefined
        ? undefined
        : createApiClient({ baseUrl: apiOrigin, token, queryDeadlineMs: 30_000 }),
    [token],
  )
  const unique = [...new Map(targets.map((target) => [skillUsageKeyOf(target), target])).values()]
  const key = JSON.stringify(unique)
  const [snapshot, setSnapshot] = useState<TUsageSnapshot | null>(null)

  useEffect(() => {
    if (api === undefined || unique.length === 0) return
    let cancelled = false
    setSnapshot({ key, revision, usage: new Map() })
    for (const target of unique) {
      void api.skills.usage
        .query(target)
        .then((reply) => {
          if (cancelled) return
          setSnapshot((current) => ({
            key,
            revision,
            usage: new Map(current?.usage).set(skillUsageKeyOf(target), reply),
          }))
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [api, key, revision])

  return snapshot?.key === key && snapshot.revision === revision ? snapshot.usage : new Map()
}
