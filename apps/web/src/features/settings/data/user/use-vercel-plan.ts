'use client'

import { EVercelPlan } from '@dltech/atlas-wire/web'

import { EQueryState } from '@/lib/use-cloud-query'

import { useUserVercelCredential } from './vercel-credential-resource'

export function useVercelPlan(): EVercelPlan {
  const { query } = useUserVercelCredential()
  if (query.state !== EQueryState.Ready) return EVercelPlan.Unknown
  return query.data.view.plan
}
