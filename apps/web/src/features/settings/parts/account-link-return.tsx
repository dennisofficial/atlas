'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { ELinkReturnKind, linkReturnOf } from '../data/personal/link-return'

const ACCOUNT_PATH = '/settings/account'

export function AccountLinkReturn({ reload }: { reload: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const linkReturn = linkReturnOf(searchParams)
  const kind = linkReturn?.kind
  const message = linkReturn?.message

  useEffect(() => {
    if (kind === undefined || message === undefined) return
    if (kind === ELinkReturnKind.Success) toast.success(message)
    else toast.error(message)
    router.replace(ACCOUNT_PATH)
    reload()
  }, [kind, message, router, reload])

  return null
}
