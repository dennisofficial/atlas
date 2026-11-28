import { createApiClient } from '@dltech/atlas-api-router'
import {
  acceptRevealRequest,
  beginRevealRequest,
  cancelRevealRequest,
  confirmationMethodsOf,
  createAccessMemberApi,
  EAccessMemberKind,
  ERevealRequestStatus,
  revealRequestPending,
  revealWithTemporarySession,
  type AccessScope,
  type RevealRequest,
} from '@dltech/atlas-client/settings'
import { EFontFamily, ETextRole, Input, Text } from '@dltech/atlas-ui-native'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { EHandoffResult, runHandoffSignIn } from '../../auth/sign-in-flow'
import { fetchSession, revokeSession, signInWithPassword } from '../../auth/session'
import { revokeOrPersist } from '../../auth/revoke-queue'
import { createPendingRevokeStorage } from '../../auth/token-store'
import { apiOrigin, webOrigin } from '../../config'
import { useAccountApi } from '../account/use-account-api'
import { ActionRow } from '../settings-parts'
import { AccessNote, accessStyles } from './access-parts'

export const SecretReveal = ({
  scope,
  name,
  kind = EAccessMemberKind.Secret,
  onEdit,
  onHidden,
}: {
  scope: AccessScope
  name: string
  kind?: EAccessMemberKind
  onEdit?: (value: string) => void
  onHidden?: () => void
}) => {
  const { api, user } = useAuth()
  const account = useAccountApi()
  const [value, setValue] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [methods, setMethods] = useState({ password: false, google: false })
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<RevealRequest>({ id: 0, status: ERevealRequestStatus.Cancelled })

  useEffect(
    () => () => {
      request.current = cancelRevealRequest(request.current)
    },
    [],
  )

  const pending = (id: number) => revealRequestPending({ request: request.current, id })
  const finish = (id: number) => {
    if (request.current.id === id && request.current.status !== ERevealRequestStatus.Cancelled) {
      setBusy(false)
    }
  }
  const reveal = async ({
    client,
    id,
  }: {
    client: ReturnType<typeof createApiClient>
    id: number
  }) => {
    const members = createAccessMemberApi({ api: client, scope })
    const revealed = await (kind === EAccessMemberKind.File
      ? members.revealFile(name)
      : members.revealSecret(name))
    if (!pending(id)) return
    request.current = acceptRevealRequest({ request: request.current, id })
    setValue(revealed)
    setMethods({ password: false, google: false })
  }
  const handleReveal = async () => {
    if (api === undefined || busy) return
    if (value !== null) {
      setValue(null)
      onHidden?.()
      return
    }
    request.current = beginRevealRequest(request.current)
    const { id } = request.current
    setBusy(true)
    setFailure('')
    try {
      await reveal({ client: api, id })
    } catch (error) {
      if (!pending(id)) return
      if (error instanceof Error && error.message.includes('REAUTH_REQUIRED')) {
        try {
          const methods = await account?.listSignInMethods()
          if (!pending(id)) return
          const available = confirmationMethodsOf(methods)
          setMethods(available)
          if (!available.password && !available.google)
            setFailure('Sign out and sign back in to reveal values.')
        } catch {
          if (pending(id)) setFailure('Your sign-in methods could not be loaded. Try again.')
        }
      } else setFailure('The value could not be revealed. Try again.')
    } finally {
      finish(id)
    }
  }
  const handleConfirm = async () => {
    if (user === undefined || busy || password === '') return
    request.current = beginRevealRequest(request.current)
    const { id } = request.current
    setBusy(true)
    setFailure('')
    try {
      const signedIn = await signInWithPassword({ apiOrigin, email: user.email, password })
      if (!signedIn.ok) {
        if (pending(id)) setFailure(signedIn.error)
        return
      }
      await revealWithTemporarySession({
        token: signedIn.token,
        isPending: () => pending(id),
        reveal: async (token) => {
          setPassword('')
          await reveal({ client: createApiClient({ baseUrl: apiOrigin, token }), id })
        },
        revoke: (token) =>
          revokeOrPersist({
            storage: createPendingRevokeStorage(),
            revoke: (value) => revokeSession({ apiOrigin, token: value }),
            token,
          }),
      })
    } catch {
      if (pending(id)) setFailure('The value could not be revealed. Try again.')
    } finally {
      finish(id)
    }
  }
  const handleGoogle = async () => {
    if (api === undefined || user === undefined || busy) return
    request.current = beginRevealRequest(request.current)
    const { id } = request.current
    setBusy(true)
    setFailure('')
    try {
      const outcome = await runHandoffSignIn({
        webOrigin,
        beginGoogleReauth: (input) => api.desktopAuth.beginGoogleReauth.mutate(input),
      })
      if (outcome.kind === EHandoffResult.Cancelled) return
      if (outcome.kind !== EHandoffResult.Redirect)
        throw new Error('Google confirmation did not complete')
      const { token } = await api.desktopAuth.exchange.mutate({
        code: outcome.code,
        codeVerifier: outcome.verifier,
        redirectUri: outcome.redirectUri,
        requireGoogleReauth: true,
      })
      await revealWithTemporarySession({
        token,
        isPending: () => pending(id),
        reveal: async (token) => {
          const freshUser = await fetchSession({ apiOrigin, token })
          if (!pending(id)) return
          if (freshUser?.id !== user.id) throw new Error('Use the Google account linked to Atlas')
          await reveal({ client: createApiClient({ baseUrl: apiOrigin, token }), id })
        },
        revoke: (token) =>
          revokeOrPersist({
            storage: createPendingRevokeStorage(),
            revoke: (value) => revokeSession({ apiOrigin, token: value }),
            token,
          }),
      })
    } catch {
      if (pending(id)) setFailure('Google confirmation did not complete. Try again.')
    } finally {
      finish(id)
    }
  }
  const handleCancel = () => {
    request.current = cancelRevealRequest(request.current)
    setMethods({ password: false, google: false })
    setPassword('')
    setBusy(false)
  }
  return (
    <>
      {value !== null && kind === EAccessMemberKind.File ? (
        <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
          <Text family={EFontFamily.Mono} size={ETextRole.Sm} style={accessStyles.note} selectable>
            {value}
          </Text>
        </ScrollView>
      ) : (
        <AccessNote>{value ?? '••••••••••••'}</AccessNote>
      )}
      <ActionRow
        label={`${value === null ? 'Reveal' : 'Hide'} ${name}`}
        loading={busy}
        onPress={() => void handleReveal()}
      />
      {value !== null && onEdit !== undefined ? (
        <ActionRow label="Edit file" onPress={() => onEdit(value)} loading={busy} />
      ) : null}
      {methods.password || methods.google ? (
        <View style={accessStyles.field}>
          <AccessNote text="Confirm it’s you. Sign in again to reveal this value." />
          {methods.password ? (
            <>
              <Input
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
              />
              <ActionRow
                label="Confirm password"
                loading={busy}
                onPress={() => void handleConfirm()}
              />
            </>
          ) : null}
          {methods.google ? (
            <ActionRow
              label="Confirm with Google"
              loading={busy}
              onPress={() => void handleGoogle()}
            />
          ) : null}
          <ActionRow label="Cancel confirmation" onPress={handleCancel} />
        </View>
      ) : null}
      {failure ? <AccessNote error>{failure}</AccessNote> : null}
    </>
  )
}
