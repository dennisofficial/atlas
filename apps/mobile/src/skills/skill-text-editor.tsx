import {
  ESkillEditorAction,
  initialSkillEditorState,
  skillEditorReducer,
  type SkillTextDocument,
} from '@dltech/atlas-client/settings'
import { Button, EFontFamily, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { NativeStackHeaderItem } from 'expo-router'
import { Stack, useNavigation, usePreventRemove } from 'expo-router'
import { useEffect, useReducer, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { confirmAction } from '../settings/confirm-action'
import { ActionRow, Section } from '../settings/settings-parts'
import type { SkillFilesApi } from './skill-files-api'

export const SkillTextEditor = ({
  doc,
  path,
  files,
  readOnly,
  onDirtyChange,
  onBusyChange,
}: {
  doc: SkillTextDocument
  path: string
  files: SkillFilesApi
  readOnly: boolean
  onBusyChange: (busy: boolean) => void
  onDirtyChange: (dirty: boolean) => void
}) => {
  const [state, dispatch] = useReducer(skillEditorReducer, doc, initialSkillEditorState)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const navigation = useNavigation()
  const dirty = state.draft !== state.saved.text || state.conflict !== null
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
  usePreventRemove(dirty || busy, ({ data }) => {
    if (busy) return
    confirmAction({
      title: 'Discard changes?',
      message: `${path} has unsaved changes.`,
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => navigation.dispatch(data.action),
    })
  })

  const handleSave = async () => {
    if (busy || readOnly || !dirty) return
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      const result = await files.save({
        path,
        text: state.draft,
        baseRevision: state.saved.revision,
      })
      if (result.outcome === 'conflict') {
        dispatch({
          type: ESkillEditorAction.Conflict,
          theirs: result.theirs,
          revision: result.revision,
        })
        return
      }
      dispatch({ type: ESkillEditorAction.Saved, text: state.draft, revision: result.revision })
      setNotice('File saved.')
    } catch {
      setFailure('The file could not be saved. Your changes are still here.')
    } finally {
      setBusy(false)
    }
  }
  const handleDiscard = () => {
    dispatch({ type: ESkillEditorAction.Discard })
    setNotice(null)
  }
  const saveItem: NativeStackHeaderItem = {
    type: 'button',
    label: 'Save',
    accessibilityLabel: 'Save file',
    icon: { type: 'sfSymbol', name: 'square.and.arrow.down' },
    disabled: !dirty || busy || readOnly,
    onPress: () => void handleSave(),
  }

  return (
    <View style={styles.editor}>
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? { unstable_headerRightItems: () => (readOnly ? [] : [saveItem]) }
            : {
                headerRight: () =>
                  readOnly ? null : (
                    <Button
                      label="Save"
                      disabled={!dirty || busy}
                      onPress={() => void handleSave()}
                    />
                  ),
              }
        }
      />
      <Text size={ETextRole.Sm}>{path}</Text>
      {state.conflict === null ? null : (
        <Section title="This file changed elsewhere">
          <View style={styles.conflict}>
            <Text size={ETextRole.Sm}>
              Your changes are kept below. Save mine uses the latest revision. Take theirs discards
              your changes.
            </Text>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              Latest version
            </Text>
            <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
              {state.conflict}
            </Text>
          </View>
          <ActionRow label="Keep mine" loading={busy} onPress={() => void handleSave()} />
          <ActionRow label="Take theirs" loading={busy} onPress={handleDiscard} />
        </Section>
      )}
      <Input
        accessibilityLabel={path}
        multiline
        value={state.draft}
        onChangeText={(text) => {
          dispatch({ type: ESkillEditorAction.Edit, text })
          setNotice(null)
        }}
        editable={!readOnly && !busy}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {readOnly ? null : (
        <>
          {dirty ? (
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              Unsaved changes
            </Text>
          ) : null}
          {Platform.OS === 'ios' ? null : (
            <Button
              label="Save file"
              disabled={!dirty || busy}
              loading={busy}
              onPress={() => void handleSave()}
            />
          )}
          {dirty ? (
            <Button label="Discard changes" disabled={busy} onPress={handleDiscard} />
          ) : null}
        </>
      )}
      {failure ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      ) : null}
      {notice ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {notice}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  editor: { gap: space(2) },
  input: { minHeight: 300, fontFamily: 'JetBrainsMono_400Regular', textAlignVertical: 'top' },
  conflict: { padding: space(3), gap: space(2) },
})
