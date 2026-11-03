import * as WebBrowser from 'expo-web-browser'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { apiOrigin } from '../../config'
import { ECallbackResult, parseAuthCallback } from '../../auth/pending-auth'
import { pendingAuthStorage } from '../../auth/token-store.web'
import { useTheme } from '../../theme/use-theme'
import { createApiClient } from '@dltech/atlas-api-router'

enum ECallbackStatus {
  Completing = 'completing',
  Closing = 'closing',
  SignedIn = 'signed-in',
  Failed = 'failed',
}

interface IPendingAuth {
  verifier: string
  state: string
  redirectUri: string
}

const readPending = (): IPendingAuth | undefined => {
  const raw = pendingAuthStorage().load()
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'verifier' in parsed &&
      'state' in parsed &&
      'redirectUri' in parsed
    ) {
      return parsed as IPendingAuth
    }
  } catch {
    return undefined
  }
  return undefined
}

export default function AuthCallbackScreen() {
  const theme = useTheme()
  const [status, setStatus] = useState(ECallbackStatus.Completing)
  const [message, setMessage] = useState('')
  const completed = useRef(false)

  useEffect(() => {
    if (completed.current) return
    completed.current = true
    const complete = async () => {
      try {
        WebBrowser.maybeCompleteAuthSession()
      } catch {
        // Full-page redirect: there is no popup session to complete.
      }
      if (window.opener !== null) {
        setStatus(ECallbackStatus.Closing)
        return
      }
      const pending = readPending()
      if (pending === undefined) {
        setStatus(ECallbackStatus.Failed)
        setMessage('No sign-in was in progress; start again from the sign-in page.')
        return
      }
      pendingAuthStorage().clear()
      const outcome = parseAuthCallback({
        url: window.location.href,
        expectedState: pending.state,
      })
      if (outcome.kind !== ECallbackResult.Success) {
        setStatus(ECallbackStatus.Failed)
        setMessage(
          outcome.kind === ECallbackResult.StateMismatch
            ? 'Sign-in could not be verified; try again.'
            : 'Sign-in did not complete.',
        )
        return
      }
      try {
        const client = createApiClient({ baseUrl: apiOrigin })
        const { token } = await client.desktopAuth.exchange.mutate({
          code: outcome.code,
          codeVerifier: pending.verifier,
          redirectUri: pending.redirectUri,
        })
        localStorage.setItem('atlas.bearer', token)
        setStatus(ECallbackStatus.SignedIn)
        window.location.replace('/')
      } catch {
        setStatus(ECallbackStatus.Failed)
        setMessage('The sign-in code could not be exchanged; try again.')
      }
    }
    void complete()
  }, [])

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {status === ECallbackStatus.Failed ? (
        <Text style={{ color: theme.destructive }}>{message}</Text>
      ) : (
        <>
          <ActivityIndicator color={theme.primary} />
          <Text style={{ color: theme.mutedForeground }}>
            {status === ECallbackStatus.Closing
              ? 'You can close this window.'
              : 'Completing sign-in…'}
          </Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
})
