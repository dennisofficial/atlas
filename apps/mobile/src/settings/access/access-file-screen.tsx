import {
  accessFileValidation,
  createAccessMemberApi,
  accessScopeOfParams,
  DEFAULT_MODE_TEXT,
  EAccessMemberKind,
  EAccessScope,
  formatFileMode,
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
import { FilePathPicker } from './file-path-picker'
import { SecretReveal } from './secret-reveal'

const FileEditor = ({
  scope,
  params,
  grants,
}: {
  scope: AccessScope
  params: AccessRouteParams
  grants: AccessGrant[]
}) => {
  const { api } = useAuth()
  const members = api === undefined ? undefined : createAccessMemberApi({ api, scope })
  const grant = grants.find((entry) => entry.id === params.grantId)
  const file = grant?.files.find((entry) => entry.path === params.name)
  const editing = params.name !== undefined
  const [path, setPath] = useState(params.name ?? '')
  const [contents, setContents] = useState('')
  const [modeText, setModeText] = useState(
    file === undefined ? DEFAULT_MODE_TEXT : formatFileMode(file.mode),
  )
  const [loaded, setLoaded] = useState(!editing)
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const personal = scope.kind === EAccessScope.Personal
  const validation = accessFileValidation({ personal, path, contents, modeText })
  const canSave =
    grant !== undefined &&
    (!editing || file !== undefined) &&
    loaded &&
    validation.draft !== null &&
    !busy
  const handleWrite = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setFailure('')
    try {
      await work()
      router.back()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The file could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const handleSave = () => {
    const draft = validation.draft
    if (!canSave || draft === null || members === undefined || grant === undefined) return
    void handleWrite(() => members.setFile({ grantId: grant.id, ...draft }))
  }
  const handleDelete = () => {
    if (members === undefined) return
    confirmAction({
      title: `Delete ${path}?`,
      message: 'The grant keeps the rest of its members. This cannot be undone.',
      confirmLabel: 'Delete file',
      destructive: true,
      onConfirm: () => void handleWrite(() => members.removeFile(path)),
    })
  }
  const handleMove = (grantId: string) => {
    if (api === undefined || grantId === '' || busy || grantId === grant?.id) return
    void handleWrite(() =>
      api.accessGrants.moveMember.mutate({
        scope,
        grantId,
        member: { kind: EAccessMemberKind.File, path },
      }),
    )
  }
  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Edit file' : 'Add file' }} />
      <AccessHeaderAction
        label="Save file"
        symbol="checkmark"
        disabled={!canSave}
        onPress={handleSave}
      />
      {grant === undefined || (editing && file === undefined) ? (
        <AccessNote
          error
          text="This file or grant no longer exists. Close this form and reload Access."
        />
      ) : (
        <>
          <Section title="Path">
            <View style={accessStyles.field}>
              <Input
                accessibilityLabel="File path"
                value={path}
                onChangeText={setPath}
                editable={!editing && !busy}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="~/.config/gh/hosts.yml"
              />
              <AccessNote error={validation.pathProblem !== null}>
                {validation.pathProblem ??
                  (personal
                    ? 'A path inside the home folder, starting with ~/ or @/'
                    : 'Relative to the repository root, or starting with ~/')}
              </AccessNote>
            </View>
          </Section>
          {!editing && scope.kind === EAccessScope.Project ? (
            <FilePathPicker projectId={scope.projectId} path={path} onChange={setPath} />
          ) : null}
          {editing ? (
            <Section title="Current contents">
              <SecretReveal
                scope={scope}
                name={path}
                kind={EAccessMemberKind.File}
                onRevealed={(value) => {
                  if (loaded) return
                  setContents(value)
                  setLoaded(true)
                }}
              />
            </Section>
          ) : null}
          {loaded ? (
            <>
              <Section title="Contents">
                <View style={accessStyles.field}>
                  <Input
                    accessibilityLabel="File contents"
                    value={contents}
                    onChangeText={setContents}
                    editable={!busy}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ minHeight: 180 }}
                  />
                  <AccessNote
                    error={validation.contentsTooLarge}
                    text={
                      validation.contentsTooLarge
                        ? 'Over 64 KiB'
                        : 'Text only, up to 64 KiB. Encrypted at rest.'
                    }
                  />
                </View>
              </Section>
              <Section title="Mode">
                <View style={accessStyles.field}>
                  <Input
                    accessibilityLabel="File mode"
                    value={modeText}
                    onChangeText={setModeText}
                    editable={!busy}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <AccessNote
                    error={validation.mode === null}
                    text={
                      validation.mode === null
                        ? 'Use three octal digits, like 0600'
                        : 'Octal permissions. 0600 is owner only.'
                    }
                  />
                </View>
              </Section>
              <Button label="Save file" disabled={!canSave} loading={busy} onPress={handleSave} />
            </>
          ) : (
            <AccessNote text="Reveal the file to load its contents before editing." />
          )}
          {editing ? (
            <>
              <Section title="Move file">
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
                  onChange={handleMove}
                />
              </Section>
              <Section>
                <ActionRow
                  label="Delete file"
                  tone={EActionTone.Destructive}
                  loading={busy}
                  onPress={handleDelete}
                />
              </Section>
            </>
          ) : null}
        </>
      )}
      {failure ? <AccessNote error>{failure}</AccessNote> : null}
    </>
  )
}

export default function AccessFileScreen() {
  const params = useLocalSearchParams<AccessRouteParams>()
  const scope = accessScopeOfParams(params)
  const { state, data, reload } = useAccess(scope)
  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="Access could not be loaded." />
      {data === null ? null : <FileEditor scope={scope} params={params} grants={data} />}
    </SettingsScroll>
  )
}
