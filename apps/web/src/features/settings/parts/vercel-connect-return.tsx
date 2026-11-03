'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { VERCEL_CONNECT_REASON_PARAM, VERCEL_CONNECT_RESULT_PARAM } from '@dltech/atlas-wire/web'

const RETURN_PARAMS = [VERCEL_CONNECT_RESULT_PARAM, VERCEL_CONNECT_REASON_PARAM]

export function VercelConnectReturn() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const result = searchParams.get(VERCEL_CONNECT_RESULT_PARAM)
  const reason = searchParams.get(VERCEL_CONNECT_REASON_PARAM)

  useEffect(() => {
    if (result === null) return
    if (result === 'connected') toast.success('Connected Vercel')
    else if (result === 'choose-project')
      toast.info('Vercel connected — choose the sandbox project')
    else {
      const detail = reason === null || reason === '' ? '' : `: ${reason}`
      toast.error(`Couldn't connect Vercel${detail}`)
    }
    const rest = new URLSearchParams(searchParams)
    for (const param of RETURN_PARAMS) rest.delete(param)
    const query = rest.toString()
    router.replace(query === '' ? pathname : `${pathname}?${query}`)
  }, [result, reason, searchParams, pathname, router])

  return null
}
