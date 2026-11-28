import { createApiClient } from '@dltech/atlas-api-router'
import { createAccessMemberApi, type AccessScope } from '@dltech/atlas-client/settings'
import { Input } from '@dltech/atlas-ui-native'
import { useState } from 'react'
import { View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { revokeSession, signInWithPassword } from '../../auth/session'
import { revokeOrPersist } from '../../auth/revoke-queue'
import { createPendingRevokeStorage } from '../../auth/token-store'
import { apiOrigin } from '../../config'
import { useAccountApi } from '../account/use-account-api'
import { ActionRow } from '../settings-parts'
import { AccessNote, accessStyles } from './access-parts'

export const SecretReveal = ({ scope, name }: { scope: AccessScope; name: string }) => {
  const { api, user } = useAuth()
  const account = useAccountApi()
  const [value, setValue] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)

  const handleReveal = async () => {
    if (api === undefined || busy) return
    if (value !== null) {
      setValue(null)
      return
    }
    setBusy(true)
    setFailure('')
    try {
      setValue(await createAccessMemberApi({ api, scope }).revealSecret(name))
    } catch (error) {
      if (error instanceof Error && error.message.includes('REAUTH_REQUIRED')) {
        try {
          const methods = await account?.listSignInMethods()
          if (methods?.password) setNeedsPassword(true)
          else setFailure('Sign out and sign back in to reveal values.')
        } catch {
          setFailure('Your sign-in methods could not be loaded. Try again.')
        }
      } else setFailure('The secret could not be revealed. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const handleConfirm = async () => {
    if (user === undefined || busy || password === '') return
    setBusy(true)
    setFailure('')
    try {
      const signedIn = await signInWithPassword({ apiOrigin, email: user.email, password })
      if (!signedIn.ok) {
        setFailure(signedIn.error)
        return
      }
      setPassword('')
      try {
        const freshApi = createApiClient({ baseUrl: apiOrigin, token: signedIn.token })
        setValue(await createAccessMemberApi({ api: freshApi, scope }).revealSecret(name))
        setNeedsPassword(false)
      } finally {
        await revokeOrPersist({
          storage: createPendingRevokeStorage(),
          revoke: (token) => revokeSession({ apiOrigin, token }),
          token: signedIn.token,
        })
      }
    } catch {
      setFailure('The secret could not be revealed. Try again.')
    } finally {
      setBusy(false)
    }
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
          <ActionRow
            label="Cancel confirmation"
            onPress={() => {
              setNeedsPassword(false)
              setPassword('')
            }}
          />
        </View>
      ) : null}
      {failure ? <AccessNote error>{failure}</AccessNote> : null}
    </>
  )
}
