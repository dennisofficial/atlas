import { createApiClient } from '@dltech/atlas-api-router'
import {
  acceptRevealRequest,
  beginRevealRequest,
  cancelRevealRequest,
  createAccessMemberApi,
  EAccessMemberKind,
  ERevealRequestStatus,
  revealRequestPending,
  type AccessScope,
  type RevealRequest,
} from '@dltech/atlas-client/settings'
import { Input } from '@dltech/atlas-ui-native'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { revokeSession, signInWithPassword } from '../../auth/session'
import { revokeOrPersist } from '../../auth/revoke-queue'
import { createPendingRevokeStorage } from '../../auth/token-store'
import { apiOrigin } from '../../config'
import { useAccountApi } from '../account/use-account-api'
import { ActionRow } from '../settings-parts'
import { AccessNote, accessStyles } from './access-parts'

export const SecretReveal = ({
  scope,
  name,
  kind = EAccessMemberKind.Secret,
  onRevealed,
}: {
  scope: AccessScope
  name: string
  kind?: EAccessMemberKind
  onRevealed?: (value: string) => void
}) => {
  const { api, user } = useAuth()
  const account = useAccountApi()
  const [value, setValue] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
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
    onRevealed?.(revealed)
    setNeedsPassword(false)
  }
  const handleReveal = async () => {
    if (api === undefined || busy) return
    if (value !== null) {
      setValue(null)
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
          if (methods?.password) setNeedsPassword(true)
          else setFailure('Sign out and sign back in to reveal values.')
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
      try {
        if (!pending(id)) return
        setPassword('')
        const freshApi = createApiClient({ baseUrl: apiOrigin, token: signedIn.token })
        await reveal({ client: freshApi, id })
      } finally {
        await revokeOrPersist({
          storage: createPendingRevokeStorage(),
          revoke: (token) => revokeSession({ apiOrigin, token }),
          token: signedIn.token,
        })
      }
    } catch {
      if (pending(id)) setFailure('The value could not be revealed. Try again.')
    } finally {
      finish(id)
    }
  }
  const handleCancel = () => {
    request.current = cancelRevealRequest(request.current)
    setNeedsPassword(false)
    setPassword('')
    setBusy(false)
  }
  return (
    <>
      <AccessNote>{value ?? '••••••••••••'}</AccessNote>
      <ActionRow
        label={`${value === null ? 'Reveal' : 'Hide'} ${name}`}
        loading={busy}
        onPress={() => void handleReveal()}
      />
      {needsPassword ? (
        <View style={accessStyles.field}>
          <AccessNote text="Confirm it’s you. Enter your password to reveal this value." />
          <Input
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
          <ActionRow label="Confirm password" loading={busy} onPress={() => void handleConfirm()} />
          <ActionRow label="Cancel confirmation" onPress={handleCancel} />
        </View>
      ) : null}
      {failure ? <AccessNote error>{failure}</AccessNote> : null}
    </>
  )
}
