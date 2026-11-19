'use client'

import type { SessionPodResourcesOutput } from '@dltech/atlas-protocol'

import { api, cloudCall } from '@/lib/api-client'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { fetchPodResources } from './pod-resources'

export function useSessionPodResources({ sessionId }: { sessionId: string }): {
  resources: SessionPodResourcesOutput
  reload: () => void
} {
  const query = useCloudQuery({
    key: `session-pod-resources:${sessionId}`,
    load: () =>
      fetchPodResources({
        api: { podResources: (input) => cloudCall(api.sessions.podResources.query(input)) },
        sessionId,
      }),
  })
  const { reload } = query
  return { resources: query.state === EQueryState.Ready ? query.data : null, reload }
}
