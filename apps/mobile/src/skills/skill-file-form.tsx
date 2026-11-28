import {
  skillDetailIsReadOnly,
  skillFilePathProblem,
  skillFileTargetOf,
} from '@dltech/atlas-client/settings'
import { Button, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useContentWidth } from '../layout/use-content-width'
import { pushedHeaderOptionsOf } from '../navigation/header-options'
import { useAuth } from '../auth/auth-provider'
import { EResourceState } from '../settings/api-resource-state'
import { StatusRows } from '../settings/settings-parts'
import { SettingsScroll } from '../settings/settings-scroll'
import { useApiResource } from '../settings/use-api-resource'
import { ESkillFileAction, SKILL_FILE_ACTION_LABELS } from './skill-file-actions'
import { type skillFileFormInputOf } from './skill-file-form-input'
import { sha256HexOfBase64 } from './skill-hash'
import { skillFilesApi } from './skill-files-api'
import { pickSkillFile } from './pick-skill-file'

type FormInput = NonNullable<ReturnType<typeof skillFileFormInputOf>>

export const SkillFileForm = ({ input }: { input: FormInput }) => {
  const barWidth = useContentWidth()
  const { api } = useAuth()
  const { target, action, path, basePath, folder, replacing } = input
  const files = useMemo(
    () => (api ? skillFilesApi({ api, target, hashOf: sha256HexOfBase64 }) : null),
    [api, target.scope, target.projectId, target.groupId, target.skill],
  )
  const resource = useApiResource({ load: async () => (files ? files.list() : []), deps: [files] })
  const [name, setName] = useState(
    action === ESkillFileAction.Rename ? (path.split('/').at(-1) ?? '') : '',
  )
  const [picked, setPicked] = useState<{ name: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const metas = resource.data ?? []
  const readOnly = skillDetailIsReadOnly(metas)
  const destination = replacing
    ? path
    : skillFileTargetOf({
        basePath,
        value: action === ESkillFileAction.Upload ? (picked?.name ?? '') : name,
      })
  const problem = replacing
    ? null
    : skillFilePathProblem({
        path: destination,
        takenPaths: metas.map((file) => file.path),
        from: action === ESkillFileAction.Rename ? path : undefined,
        folder: action === ESkillFileAction.NewFolder || folder,
      })
  const canSubmit =
    files !== null &&
    resource.state === EResourceState.Ready &&
    !readOnly &&
    !busy &&
    problem === null &&
    (action !== ESkillFileAction.Upload || picked !== null)
  const title = replacing ? 'Replace file' : SKILL_FILE_ACTION_LABELS[action]

  const handlePick = async () => {
    try {
      const next = await pickSkillFile()
      if (next) setPicked(next)
    } catch {
      setFailure('The file could not be opened.')
    }
  }
  const handleSubmit = async () => {
    if (!files || !canSubmit) return
    setBusy(true)
    setFailure(null)
    try {
      const fresh = await files.list()
      if (skillDetailIsReadOnly(fresh)) throw new Error('Built-in skill is read-only')
      if (action === ESkillFileAction.Rename) await files.rename({ from: path, to: destination })
      else if (action === ESkillFileAction.Upload && picked) {
        const revision = replacing ? metas.find((file) => file.path === path)?.revision : undefined
        await files.write({ path: destination, content: picked.content, baseRevision: revision })
      } else
        await files.addText({
          path: action === ESkillFileAction.NewFolder ? `${destination}/.gitkeep` : destination,
        })
      router.back()
    } catch {
      setFailure(
        'The file action failed. A file may have changed elsewhere. Your inputs are still here; cancel and reopen to reload.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsScroll>
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? {
                ...pushedHeaderOptionsOf({ title, barWidth }),
                unstable_headerRightItems: () => [
                  {
                    type: 'button',
                    label: 'Save',
                    accessibilityLabel: 'Save file action',
                    icon: { type: 'sfSymbol', name: 'checkmark' },
                    disabled: !canSubmit,
                    onPress: () => void handleSubmit(),
                  },
                ],
              }
            : pushedHeaderOptionsOf({ title, barWidth })
        }
      />
      <StatusRows state={resource.state} onRetry={resource.reload} />
      <View style={styles.form}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {replacing ? `Replace ${path}.` : `Inside ${basePath || 'the skill root'}.`}
        </Text>
        {action === ESkillFileAction.Upload ? (
          <>
            <Button label="Choose file" disabled={busy} onPress={() => void handlePick()} />
            {picked ? <Text size={ETextRole.Sm}>{picked.name}</Text> : null}
          </>
        ) : (
          <Input
            accessibilityLabel={
              action === ESkillFileAction.NewFolder || folder ? 'Folder name' : 'File name'
            }
            placeholder={action === ESkillFileAction.NewFolder ? 'references' : 'notes.md'}
            value={name}
            onChangeText={setName}
            editable={!busy && !readOnly}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
        {problem && (name || picked) ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {problem}
          </Text>
        ) : null}
        {readOnly ? <Text size={ETextRole.Sm}>Built-in skills are read-only.</Text> : null}
        <Button
          label={title}
          disabled={!canSubmit}
          loading={busy}
          onPress={() => void handleSubmit()}
        />
        {failure ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {failure}
          </Text>
        ) : null}
      </View>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({ form: { gap: space(3) } })
