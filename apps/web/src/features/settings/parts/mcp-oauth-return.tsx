'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { ELinkReturnKind } from '../data/personal/link-return'
import { MCP_OAUTH_RETURN_PARAMS, mcpOauthReturnOf } from '../data/shared/mcp-oauth'

export function McpOauthReturn({ reload }: { reload: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const oauthReturn = mcpOauthReturnOf(searchParams)
  const kind = oauthReturn?.kind
  const message = oauthReturn?.message

  useEffect(() => {
    if (kind === undefined || message === undefined) return
    if (kind === ELinkReturnKind.Success) toast.success(message)
    else toast.error(message)
    const rest = new URLSearchParams(searchParams)
    for (const param of MCP_OAUTH_RETURN_PARAMS) rest.delete(param)
    const query = rest.toString()
    router.replace(query === '' ? pathname : `${pathname}?${query}`)
    reload()
  }, [kind, message, searchParams, pathname, router, reload])

  return null
}
