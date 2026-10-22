'use client'

import { useCallback } from 'react'

import { requestPasswordReset } from '@/lib/auth-api'
import { linkGoogleUrl, unlinkSignInMethod, type SignInMethodIds } from '@/lib/auth-accounts'

import { useSaveAction } from './use-save-action'

export const SETUP_LINK_SENT = 'Check your email to set a password.'
export const GOOGLE_UNLINKED = 'Google unlinked'
export const PASSWORD_REMOVED = 'Password removed'

export function useSignInMethodActions(args: {
  email: string
  methods: SignInMethodIds
  reload: () => void
}): {
  busy: boolean
  linkGoogle: () => Promise<void>
  unlinkGoogle: () => Promise<void>
  sendSetupLink: () => Promise<void>
  removePassword: () => Promise<void>
} {
  const { email, methods, reload } = args
  const { saving, run } = useSaveAction()

  const linkGoogle = useCallback(async () => {
    await run({
      work: async () => {
        window.location.assign(await linkGoogleUrl({ origin: window.location.origin }))
      },
    })
  }, [run])

  const unlinkMethod = useCallback(
    async (args: { accountId: string | null; success: string }) => {
      if (args.accountId === null) return
      const accountId = args.accountId
      const saved = await run({
        work: () => unlinkSignInMethod(accountId),
        success: args.success,
      })
      if (saved) reload()
    },
    [run, reload],
  )

  const unlinkGoogle = useCallback(
    () => unlinkMethod({ accountId: methods.google, success: GOOGLE_UNLINKED }),
    [unlinkMethod, methods.google],
  )

  const removePassword = useCallback(
    () => unlinkMethod({ accountId: methods.password, success: PASSWORD_REMOVED }),
    [unlinkMethod, methods.password],
  )

  const sendSetupLink = useCallback(async () => {
    await run({
      work: () => requestPasswordReset({ email, origin: window.location.origin }),
      success: SETUP_LINK_SENT,
    })
  }, [run, email])

  return { busy: saving, linkGoogle, unlinkGoogle, sendSetupLink, removePassword }
}
