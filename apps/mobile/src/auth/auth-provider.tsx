import { createApiClient, type ApiClient } from '@dltech/atlas-api-router'
import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'

import { apiOrigin, webOrigin } from '../config'
import { createPushApi } from '../push/push-api'
import { pushDeviceIdOf, type TPushRegistration } from '../push/push-registration'
import { usePushRegistration } from '../push/use-push-registration'
import { EAppleSignInResult, isAppleSignInAvailable, signInWithApple } from './apple-sign-in'
import {
  authReducer,
  EAuthEvent,
  EAuthState,
  initialAuthSnapshot,
  type IAuthSnapshot,
  type IAuthUser,
} from './auth-reducer'
import { retryPendingRevokes, revokeOrPersist } from './revoke-queue'
import { fetchSession, revokeSession, signInWithPassword } from './session'
import { EHandoffResult, runHandoffSignIn } from './sign-in-flow'
import { createPendingRevokeStorage, createTokenStore } from './token-store'
import { clearSettingsCache } from '../settings/settings-storage'
import { selectedSessionStore } from '../sessions/selected-session'
import { clearSessionLog } from '../thread/session/session-cache'
import { XhrEventSource } from '../thread/session/xhr-event-source'

export interface IAuthContextValue extends IAuthSnapshot {
  api: ApiClient | undefined
  signIn: () => Promise<void>
  signInWithApple: () => Promise<void>
  signInWithEmail: (credentials: { email: string; password: string }) => Promise<void>
  appleSignInAvailable: boolean
  pushRegistration: TPushRegistration
  signOut: () => Promise<void>
}

const AuthContext = createContext<IAuthContextValue | undefined>(undefined)

const messageOf = (outcome: { kind: EHandoffResult }): string => {
  if (outcome.kind === EHandoffResult.StateMismatch)
    return 'Sign-in could not be verified; try again'
  if (outcome.kind === EHandoffResult.MissingCode) return 'Sign-in did not complete'
  return 'Sign-in was cancelled'
}

const revokeBearer = (token: string) => revokeSession({ apiOrigin, token })

const completeSignIn = async ({
  token,
  store,
}: {
  token: string
  store: ReturnType<typeof createTokenStore>
}): Promise<{ token: string; user: IAuthUser } | undefined> => {
  const user = await fetchSession({ apiOrigin, token })
  if (user === undefined) return undefined
  await store.save(token)
  return { token, user }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const store = useMemo(() => createTokenStore(), [])
  const [snapshot, dispatch] = useReducer(authReducer, initialAuthSnapshot)
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false)
  const pendingRevokes = useMemo(() => createPendingRevokeStorage(), [])

  useEffect(() => {
    const retry = () => {
      void retryPendingRevokes({ storage: pendingRevokes, revoke: revokeBearer })
    }
    retry()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry()
    })
    return () => subscription.remove()
  }, [pendingRevokes])

  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleSignInAvailable)
  }, [])

  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      const token = await store.load()
      if (token === undefined) {
        if (!cancelled) dispatch({ type: EAuthEvent.RestoreMissing })
        return
      }
      const user = await fetchSession({ apiOrigin, token })
      if (cancelled) return
      if (user === undefined) {
        await store.clear()
        dispatch({ type: EAuthEvent.RestoreFailed })
        return
      }
      dispatch({ type: EAuthEvent.RestoreSucceeded, token, user })
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [store])

  const api = useMemo(
    () =>
      snapshot.token === undefined
        ? undefined
        : createApiClient({
            baseUrl: apiOrigin,
            token: snapshot.token,
            EventSource: XhrEventSource,
          }),
    [snapshot.token],
  )

  const pushRegistration = usePushRegistration({
    api: snapshot.state === EAuthState.SignedIn ? api : undefined,
  })

  const signIn = async () => {
    if (snapshot.state !== EAuthState.SignedOut && snapshot.state !== EAuthState.Failed) return
    dispatch({ type: EAuthEvent.BeginSignIn })
    try {
      const outcome = await runHandoffSignIn({ webOrigin })
      if (outcome.kind === EHandoffResult.Cancelled) {
        dispatch({ type: EAuthEvent.SignInCancelled })
        return
      }
      if (outcome.kind !== EHandoffResult.Redirect) {
        dispatch({ type: EAuthEvent.SignInFailed, error: messageOf(outcome) })
        return
      }
      const exchangeClient = createApiClient({ baseUrl: apiOrigin })
      const { token } = await exchangeClient.desktopAuth.exchange.mutate({
        code: outcome.code,
        codeVerifier: outcome.verifier,
        redirectUri: outcome.redirectUri,
      })
      const session = await completeSignIn({ token, store })
      if (session === undefined) {
        dispatch({ type: EAuthEvent.SignInFailed, error: 'The session could not be verified' })
        return
      }
      dispatch({ type: EAuthEvent.SignInSucceeded, token: session.token, user: session.user })
    } catch {
      dispatch({ type: EAuthEvent.SignInFailed, error: 'Sign-in failed; check your connection' })
    }
  }

  const handleAppleSignIn = async () => {
    if (snapshot.state !== EAuthState.SignedOut && snapshot.state !== EAuthState.Failed) return
    dispatch({ type: EAuthEvent.BeginSignIn })
    const outcome = await signInWithApple({ apiOrigin })
    if (outcome.kind === EAppleSignInResult.Cancelled) {
      dispatch({ type: EAuthEvent.SignInCancelled })
      return
    }
    if (outcome.kind === EAppleSignInResult.Failed) {
      dispatch({ type: EAuthEvent.SignInFailed, error: outcome.error })
      return
    }
    const session = await completeSignIn({ token: outcome.token, store })
    if (session === undefined) {
      dispatch({ type: EAuthEvent.SignInFailed, error: 'The session could not be verified' })
      return
    }
    dispatch({ type: EAuthEvent.SignInSucceeded, token: session.token, user: session.user })
  }

  const handleEmailSignIn = async ({ email, password }: { email: string; password: string }) => {
    if (snapshot.state !== EAuthState.SignedOut && snapshot.state !== EAuthState.Failed) return
    dispatch({ type: EAuthEvent.BeginSignIn })
    const outcome = await signInWithPassword({ apiOrigin, email, password })
    if (!outcome.ok) {
      dispatch({ type: EAuthEvent.SignInFailed, error: outcome.error })
      return
    }
    const session = await completeSignIn({ token: outcome.token, store })
    if (session === undefined) {
      dispatch({ type: EAuthEvent.SignInFailed, error: 'The session could not be verified' })
      return
    }
    dispatch({ type: EAuthEvent.SignInSucceeded, token: session.token, user: session.user })
  }

  const signOut = async () => {
    const bearer = snapshot.token
    const pushDeviceId = pushDeviceIdOf(pushRegistration)
    dispatch({ type: EAuthEvent.SignOut })
    await store.clear()
    selectedSessionStore().select(null)
    await Promise.all([clearSessionLog(), clearSettingsCache()])
    if (bearer === undefined) return
    if (pushDeviceId !== undefined) {
      const client = createApiClient({ baseUrl: apiOrigin, token: bearer })
      await createPushApi({ client })
        .unregister({ deviceId: pushDeviceId })
        .catch(() => undefined)
    }
    await revokeOrPersist({ storage: pendingRevokes, revoke: revokeBearer, token: bearer })
  }

  const value: IAuthContextValue = {
    ...snapshot,
    api,
    signIn,
    signInWithApple: handleAppleSignIn,
    signInWithEmail: handleEmailSignIn,
    appleSignInAvailable,
    pushRegistration,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): IAuthContextValue => {
  const value = useContext(AuthContext)
  if (value === undefined) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
