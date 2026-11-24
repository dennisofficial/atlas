import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ESigningKeyView,
  fingerprintTailOf,
  hasSigningKey,
  type SigningKeyAccountView,
  type SigningKeyView,
} from '../ui/components/settings/signing-key-row'
import { generateSigningKeyPair } from './account/signing-key'
import type { SessionApi } from './session-api'

export type SigningKeyControl = SigningKeyAccountView & {
  refresh: () => void
}

const ABSENT: SigningKeyView = { state: ESigningKeyView.Absent }
const UNAVAILABLE: SigningKeyView = { state: ESigningKeyView.Unavailable }

const commentOf = (login: string): string => `atlas@${login}`

const registeredView = (tail: string): SigningKeyView => ({
  state: ESigningKeyView.Registered,
  fingerprintTail: tail,
})

const busyViewOf = (current: SigningKeyView): SigningKeyView =>
  current.fingerprintTail === undefined
    ? { state: ESigningKeyView.Busy }
    : { state: ESigningKeyView.Busy, fingerprintTail: current.fingerprintTail }

const sameView = (args: { a: SigningKeyView; b: SigningKeyView }): boolean =>
  args.a.state === args.b.state && args.a.fingerprintTail === args.b.fingerprintTail

export function useSigningKey(args: {
  api: SessionApi | null
  githubLogin: string | null
  onProblem: (reason: string) => void
}): SigningKeyControl {
  const { api, githubLogin } = args
  const [view, setView] = useState<SigningKeyView>(ABSENT)
  const viewRef = useRef(view)
  const busy = useRef(false)
  const mounted = useRef(true)
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  const put = useCallback((next: SigningKeyView) => {
    if (sameView({ a: viewRef.current, b: next })) return
    viewRef.current = next
    setView(next)
  }, [])

  const refresh = useCallback(() => {
    if (api === null || busy.current) return

    void api.signingKeyStatus().then(
      (status) => {
        if (!mounted.current || busy.current) return
        put(
          status.state === 'registered'
            ? registeredView(fingerprintTailOf({ publicKey: status.publicKey }))
            : ABSENT,
        )
      },
      () => {
        if (mounted.current && !busy.current) put(UNAVAILABLE)
      },
    )
  }, [api, put])

  const run = useCallback(
    async (action: () => Promise<void>, label: string): Promise<void> => {
      if (api === null || busy.current) return
      busy.current = true
      put(busyViewOf(viewRef.current))
      try {
        await action()
        if (mounted.current) refresh()
      } catch (failure) {
        if (!mounted.current) return
        put(viewRef.current.state === ESigningKeyView.Busy ? ABSENT : viewRef.current)
        problem.current(
          `could not ${label} — ${failure instanceof Error ? failure.message : String(failure)}`,
        )
      } finally {
        busy.current = false
      }
    },
    [api, put, refresh],
  )

  const activateRotateOrEnable = useCallback(() => {
    const login = githubLogin
    if (login === null) return

    void run(async () => {
      const pair = generateSigningKeyPair({ comment: commentOf(login) })
      await api?.registerSigningKey({ privateKey: pair.privateKey })
    }, 'register the commit signing key')
  }, [api, githubLogin, run])

  const activateRemove = useCallback(() => {
    if (!hasSigningKey(viewRef.current)) return
    void run(async () => {
      await api?.revokeSigningKey()
    }, 'remove the commit signing key')
  }, [api, run])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (githubLogin === null) {
      put(ABSENT)
      return
    }
    refresh()
  }, [githubLogin, put, refresh])

  return useMemo(
    () => ({ view, activateRotateOrEnable, activateRemove, refresh }),
    [activateRemove, activateRotateOrEnable, refresh, view],
  )
}
