import {
  canSaveInstructions,
  charCountOf,
  type TInstructionsDoc,
} from '@dltech/atlas-client/settings'
import { Button, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import * as Clipboard from 'expo-clipboard'
import { Stack, useNavigation, usePreventRemove } from 'expo-router'
import type { NativeStackHeaderItem } from 'expo-router'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { confirmAction } from './confirm-action'
import { ActionRow, EActionTone, Section } from './settings-parts'

export const InstructionsEditor = ({
  doc,
  limit,
  onSave,
  inherited,
}: {
  doc: TInstructionsDoc
  limit: number
  onSave: (args: { text: string; baseRevision: number }) => Promise<TInstructionsDoc>
  inherited?: ReactNode
}) => {
  const [saved, setSaved] = useState(doc)
  const [text, setText] = useState(doc.text)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const navigation = useNavigation()
  const count = charCountOf({ length: text.length, limit })
  const dirty = text !== saved.text
  const canSave = canSaveInstructions({ dirty, length: text.length, limit, saving })

  usePreventRemove(dirty, ({ data }) => {
    confirmAction({
      title: 'Discard changes?',
      message: 'These instructions have unsaved changes.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => navigation.dispatch(data.action),
    })
  })

  const handleChange = (next: string) => {
    setText(next)
    setNotice(null)
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setFailure(null)
    setNotice(null)
    try {
      const next = await onSave({ text, baseRevision: saved.revision })
      setSaved(next)
      setText(next.text)
      setNotice('Instructions saved.')
    } catch {
      setFailure('The instructions could not be saved. Reload and try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setText(saved.text)
    setNotice(null)
  }

  const handleCopy = async () => {
    await Clipboard.setStringAsync(text)
    setNotice('Copied.')
  }

  const saveItem: NativeStackHeaderItem = {
    type: 'button',
    label: 'Save',
    icon: { type: 'sfSymbol', name: 'square.and.arrow.down' },
    accessibilityLabel: 'Save instructions',
    disabled: !canSave,
    onPress: () => void handleSave(),
  }

  return (
    <>
      <Stack.Screen
        options={{
          unstable_headerRightItems: Platform.OS === 'ios' ? () => [saveItem] : undefined,
        }}
      />
      <View style={styles.section}>
        <Input
          value={text}
          onChangeText={handleChange}
          multiline
          accessibilityLabel="Instructions"
          placeholder="Write what the agent should know in every thread."
          style={styles.editor}
        />
        <Text size={ETextRole.Sm} tone={count.over ? ETextTone.Destructive : ETextTone.Muted}>
          {count.text}
        </Text>
        <Button
          label="Save"
          stretch
          loading={saving}
          disabled={!canSave}
          onPress={() => void handleSave()}
        />
        {failure === null ? null : (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {failure}
          </Text>
        )}
        {notice === null ? null : (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {notice}
          </Text>
        )}
      </View>
      <Section>
        <ActionRow label="Copy instructions" onPress={() => void handleCopy()} />
        {dirty ? (
          <ActionRow
            label="Discard changes"
            tone={EActionTone.Destructive}
            onPress={handleDiscard}
          />
        ) : null}
      </Section>
      {inherited}
    </>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: space(2),
  },
  editor: {
    minHeight: 320,
  },
})
