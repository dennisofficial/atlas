import {
  ACCESS_GRANT_INSTRUCTION_MAX,
  ACCESS_GRANT_NAME_MAX,
  EAccessMemberKind,
  SECRET_NAME,
  createAccessMemberApi,
  accessGrantSaveOf,
  accessScopeOfParams,
  parseEnvLines,
  moveTargetsOf,
  type AccessGrant,
  type AccessRouteParams,
  type AccessScope,
} from '@dltech/atlas-client/settings'
import { Button, Input } from '@dltech/atlas-ui-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { ChoiceRow } from '../choice-row'
import { confirmAction } from '../confirm-action'
import { ActionRow, EActionTone, Section, StatusRows } from '../settings-parts'
import { SettingsScroll } from '../settings-scroll'
import { AccessHeaderAction, AccessNote, accessStyles, useAccess } from './access-parts'
import { SecretReveal } from './secret-reveal'

type FormProps = { scope: AccessScope; params: AccessRouteParams; grants: AccessGrant[] }

const AccessEditor = ({ scope, params, grants }: FormProps) => {
  const { api } = useAuth()
  const members = api === undefined ? undefined : createAccessMemberApi({ api, scope })
  const grant = grants.find((entry) => entry.id === params.grantId)
  const isGrant = params.mode === 'grant'
  const isBulk = params.mode === 'bulk'
  const editingSecret = !isGrant && !isBulk && params.name !== undefined
  const [name, setName] = useState(isGrant ? (grant?.name ?? '') : (params.name ?? ''))
  const [value, setValue] = useState(isGrant ? (grant?.instruction ?? '') : '')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = parseEnvLines(value)
  const canSave =
    !busy &&
    (params.grantId === undefined || grant !== undefined) &&
    (isGrant
      ? name.trim() !== '' &&
        name.trim().length <= ACCESS_GRANT_NAME_MAX &&
        value.length <= ACCESS_GRANT_INSTRUCTION_MAX
      : isBulk
        ? parsed.pairs.length > 0
        : SECRET_NAME.test(name) && value !== '')
  const title = isGrant
    ? grant
      ? 'Edit grant'
      : 'New grant'
    : isBulk
      ? 'Bulk add secrets'
      : editingSecret
        ? (params.name ?? 'Secret')
        : 'Add secret'

  const handleWrite = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setFailure('')
    try {
      await work()
      router.back()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'This could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const handleSave = () => {
    if (!canSave || api === undefined || members === undefined) return
    void handleWrite(async () => {
      if (isGrant) {
        await api.accessGrants.save.mutate(
          accessGrantSaveOf({
            scope,
            draft: {
              ...(grant === undefined ? {} : { id: grant.id }),
              name: name.trim(),
              instruction: value,
            },
          }),
        )
        return
      }
      if (grant === undefined) throw new Error('The grant no longer exists.')
      if (isBulk) {
        for (const pair of parsed.pairs) await members.setSecret({ grantId: grant.id, ...pair })
        return
      }
      await members.setSecret({ grantId: grant.id, name, value })
    })
  }
  const handleDelete = () => {
    if (members === undefined) return
    confirmAction({
      title: `Delete ${name}?`,
      message: 'This secret will no longer be available to new threads. This cannot be undone.',
      confirmLabel: 'Delete secret',
      destructive: true,
      onConfirm: () => void handleWrite(() => members.removeSecret(name)),
    })
  }
  const handleMove = (grantId: string) => {
    if (api === undefined || grantId === '') return
    void handleWrite(() =>
      api.accessGrants.moveMember.mutate({
        scope,
        grantId,
        member: { kind: EAccessMemberKind.Secret, name },
      }),
    )
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <AccessHeaderAction
        label="Save"
        symbol="checkmark"
        disabled={!canSave}
        onPress={handleSave}
      />
      {params.grantId !== undefined && grant === undefined ? (
        <AccessNote error text="The grant no longer exists. Close this form and reload Access." />
      ) : (
        <>
          {editingSecret ? (
            <Section title="Current value">
              <SecretReveal scope={scope} name={name} />
            </Section>
          ) : null}
          {isBulk ? null : (
            <Section title={isGrant ? 'Grant name' : 'Secret name'}>
              <View style={accessStyles.field}>
                <Input
                  accessibilityLabel={isGrant ? 'Grant name' : 'Secret name'}
                  value={name}
                  onChangeText={(text) => setName(isGrant ? text : text.toUpperCase())}
                  editable={!editingSecret}
                  autoCapitalize={isGrant ? 'sentences' : 'characters'}
                  autoCorrect={false}
                  maxLength={isGrant ? ACCESS_GRANT_NAME_MAX : undefined}
                />
                {!isGrant && name !== '' && !SECRET_NAME.test(name) ? (
                  <AccessNote
                    error
                    text="Letters, digits, and underscores; not starting with a digit."
                  />
                ) : null}
              </View>
            </Section>
          )}
          <Section
            title={
              isGrant
                ? 'Instruction'
                : isBulk
                  ? 'One KEY=value per line'
                  : editingSecret
                    ? 'New value'
                    : 'Value'
            }
          >
            <View style={accessStyles.field}>
              <Input
                accessibilityLabel={
                  isGrant ? 'Instruction' : isBulk ? 'One KEY=value per line' : 'Value'
                }
                value={value}
                onChangeText={setValue}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={isGrant ? ACCESS_GRANT_INSTRUCTION_MAX : undefined}
                style={{ minHeight: isBulk ? 180 : 100 }}
              />
              <AccessNote>
                {isGrant
                  ? `${value.length} / ${ACCESS_GRANT_INSTRUCTION_MAX}`
                  : isBulk
                    ? 'Paste a .env file. Existing names are overwritten. Blank lines and # comments are ignored.'
                    : 'Encrypted at rest. Available to threads in this scope as an environment variable.'}
              </AccessNote>
              {isBulk && parsed.invalid.length > 0 ? (
                <AccessNote
                  error
                  text={`Lines ${parsed.invalid.join(', ')} skipped: not KEY=value.`}
                />
              ) : null}
            </View>
          </Section>
          {failure ? <AccessNote error>{failure}</AccessNote> : null}
          <Button
            label={isBulk ? `Add ${parsed.pairs.length} secrets` : 'Save'}
            disabled={!canSave}
            loading={busy}
            onPress={handleSave}
          />
          {editingSecret && grant !== undefined ? (
            <>
              <Section title="Move secret">
                <ChoiceRow
                  label="Move to grant"
                  value={grant.id}
                  options={[
                    { label: grant.name, value: grant.id },
                    ...moveTargetsOf({ grants, fromGrantId: grant.id }).map((target) => ({
                      label: target.name,
                      value: target.id,
                    })),
                  ]}
                  onChange={(id) => {
                    if (id !== grant.id && !busy) handleMove(id)
                  }}
                />
              </Section>
              <Section>
                <ActionRow
                  label="Delete secret"
                  tone={EActionTone.Destructive}
                  loading={busy}
                  onPress={handleDelete}
                />
              </Section>
            </>
          ) : null}
        </>
      )}
    </>
  )
}

export default function AccessFormScreen() {
  const params = useLocalSearchParams<AccessRouteParams>()
  const scope = accessScopeOfParams(params)
  const { state, data, reload } = useAccess(scope)
  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="Access could not be loaded." />
      {data === null ? null : <AccessEditor scope={scope} params={params} grants={data} />}
    </SettingsScroll>
  )
}
