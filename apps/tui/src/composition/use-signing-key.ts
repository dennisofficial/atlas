import {
  ensureSigningKey,
  ESigningKeyOutcome,
  removeSigningKey,
  rotateSigningKey,
  SigningKeyClient,
  type CloudService,
} from '@dltech/atlas-harness'
import { ESshSigningKeyState, SSH_SIGNING_SCOPE_NOTICE, type SshSigningKeyStatus } from '@dltech/atlas-wire'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clientVersionHeader } from '../build/info'
import {
  ESigningKeyView,
  fingerprintTailOf,
  hasSigningKey,
  type SigningKeyAccountView,
  type SigningKeyView,
} from '../ui/components/settings/signing-key-row'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'

export type SigningKeyControl = SigningKeyAccountView & {
  refresh: () => void
}

const NOTICE_KEY_SCOPE_MISSING = 'signing-scope-missing'

const ABSENT: SigningKeyView = { state: ESigningKeyView.Absent }
const UNAVAILABLE: SigningKeyView = { state: ESigningKeyView.Unavailable }
const SCOPE_MISSING: SigningKeyView = { state: ESigningKeyView.ScopeMissing }

const commentOf = (login: string): string => `atlas@${login}`

const registeredView = (tail: string): SigningKeyView => ({
  state: ESigningKeyView.Registered,
  fingerprintTail: tail,
})

const busyViewOf = (current: SigningKeyView): SigningKeyView =>
  current.fingerprintTail === undefined
    ? { state: ESigningKeyView.Busy }
    : { state: ESigningKeyView.Busy, fingerprintTail: current.fingerprintTail }

const sameView = (a: SigningKeyView, b: SigningKeyView): boolean =>
  a.state === b.state && a.fingerprintTail === b.fingerprintTail

const infoNotice = (text: string): void => notify({ text, tone: ENoticeTone.Info })

export function useSigningKey(args: {
  cloud: CloudService
  githubLogin: string | null
  fetchFn?: typeof fetch | undefined
}): SigningKeyControl {
  const { cloud, githubLogin, fetchFn } = args
  const [view, setView] = useState<SigningKeyView>(ABSENT)
  const viewRef = useRef(view)
  const busy = useRef(false)
  const scopeMissing = useRef(false)
  const ensured = useRef<string | null>(null)
  const seenLogin = useRef<string | null>(null)
  const loginRef = useRef(githubLogin)
  loginRef.current = githubLogin

  const put = useCallback((next: SigningKeyView) => {
    if (sameView(viewRef.current, next)) return
    viewRef.current = next
    setView(next)
  }, [])

  const clientOf = useCallback((): SigningKeyClient | null => {
    const session = cloud.session()
    if (session === null) return null
    return new SigningKeyClient({
      url: session.url,
      token: session.token,
      clientVersion: clientVersionHeader(),
      fetchFn,
    })
  }, [cloud, fetchFn])

  const viewOfStatus = useCallback((status: SshSigningKeyStatus): SigningKeyView => {
    if (status.state === ESshSigningKeyState.Registered) {
      return registeredView(fingerprintTailOf({ publicKey: status.publicKey }))
    }
    return scopeMissing.current ? SCOPE_MISSING : ABSENT
  }, [])

  const refresh = useCallback(() => {
    const client = clientOf()
    if (client === null || busy.current) return

    void client
      .status()
      .then((status) => {
        if (!busy.current) put(viewOfStatus(status))
      })
      .catch(() => {
        if (!busy.current) put(UNAVAILABLE)
      })
  }, [clientOf, put, viewOfStatus])

  const settleOutcome = useCallback(
    (outcome: ESigningKeyOutcome) => {
      scopeMissing.current = outcome === ESigningKeyOutcome.ScopeMissing
      if (outcome === ESigningKeyOutcome.ScopeMissing) {
        notify({
          key: NOTICE_KEY_SCOPE_MISSING,
          text: SSH_SIGNING_SCOPE_NOTICE,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
        put(SCOPE_MISSING)
        return
      }
      if (outcome === ESigningKeyOutcome.GithubNotConnected) {
        put(ABSENT)
        return
      }
      if (outcome === ESigningKeyOutcome.Unavailable) {
        put(UNAVAILABLE)
        return
      }
      if (outcome === ESigningKeyOutcome.Rotated) infoNotice('commit signing key rotated')
      if (outcome === ESigningKeyOutcome.Removed) infoNotice('commit signing key removed')
      refresh()
    },
    [put, refresh],
  )

  const run = useCallback(
    async (action: () => Promise<ESigningKeyOutcome>) => {
      if (busy.current) return
      busy.current = true
      put(busyViewOf(viewRef.current))
      const outcome = await action()
      busy.current = false
      settleOutcome(outcome)
    },
    [put, settleOutcome],
  )

  const ensureFor = useCallback(
    (login: string) => {
      if (ensured.current === login) return
      const client = clientOf()
      if (client === null) return
      ensured.current = login
      void run(() => ensureSigningKey({ client, comment: commentOf(login) }))
    },
    [clientOf, run],
  )

  useEffect(() => {
    if (githubLogin === null) {
      if (seenLogin.current === null) return
      seenLogin.current = null
      ensured.current = null
      scopeMissing.current = false
      return
    }
    seenLogin.current = githubLogin
    ensureFor(githubLogin)
  }, [githubLogin, ensureFor])

  useEffect(() => {
    const client = cloud.client()
    if (client === null) return
    void client
      .githubConnection()
      .then((found) => {
        if (found !== null) ensureFor(found.login)
      })
      .catch(() => undefined)
  }, [cloud, ensureFor])

  const activateRotateOrEnable = useCallback(() => {
    const login = loginRef.current
    const client = clientOf()
    if (login === null || client === null) return

    const current = viewRef.current
    if (hasSigningKey(current)) {
      void run(() => rotateSigningKey({ client, comment: commentOf(login) }))
      return
    }
    if (current.state === ESigningKeyView.Absent) {
      void run(() => ensureSigningKey({ client, comment: commentOf(login) }))
      return
    }
    if (current.state === ESigningKeyView.Unavailable) refresh()
  }, [clientOf, refresh, run])

  const activateRemove = useCallback(() => {
    const client = clientOf()
    if (client === null || !hasSigningKey(viewRef.current)) return
    void run(() => removeSigningKey({ client }))
  }, [clientOf, run])

  return useMemo(
    () => ({ view, activateRotateOrEnable, activateRemove, refresh }),
    [view, activateRotateOrEnable, activateRemove, refresh],
  )
}
