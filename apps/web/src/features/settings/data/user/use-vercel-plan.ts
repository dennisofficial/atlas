'use client'

import { EVercelPlan } from '@dltech/atlas-wire/web'

import { useCloudQuery, EQueryState } from '@/lib/use-cloud-query'

import { getUserVercelCredential } from './vercel-credential-api'

export function useVercelPlan(): EVercelPlan {
  const query = useCloudQuery({
    key: 'user-vercel-credential',
    load: getUserVercelCredential,
  })
  if (query.state !== EQueryState.Ready) return EVercelPlan.Unknown
  return query.data.plan
}
