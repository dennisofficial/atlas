import {
  EMemoryScope,
  type EMemoryType,
  MEMORY_MAX_BODY_CHARS,
  MEMORY_MAX_DESCRIPTION_CHARS,
  MEMORY_TYPE_LABELS,
  MEMORY_TYPE_OPTIONS,
  formatMemoryDate,
  type MemoryEntry,
  type MemoryKey,
} from '@dltech/atlas-client/settings'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Markdown,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import type { NativeStackHeaderItem } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { ChoiceRow } from '../../../settings/choice-row'
import { confirmAction } from '../../../settings/confirm-action'
import { deleteMemoryEntry, loadMemoryEntry, saveMemoryEntry } from '../../../settings/memory-api'
import { ActionRow, EActionTone, Row, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'

const scopeOf = (value: string): EMemoryScope =>
  Object.values(EMemoryScope).find((candidate) => candidate === value) ?? EMemoryScope.Global

const optionalOf = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value

const CloseButton = () => (
  <Button
    label="Close"
    variant={EButtonVariant.Ghost}
    size={EButtonSize.Sm}
    onPress={() => router.back()}
  />
)

const SaveButton = ({ enabled, onPress }: { enabled: boolean; onPress: () => void }) => {
  const item: NativeStackHeaderItem = {
    type: 'button',
    label: 'Save',
    icon: { type: 'sfSymbol', name: 'square.and.arrow.down' },
    accessibilityLabel: 'Save memory',
    disabled: !enabled,
    onPress,
  }
  return (
    <Stack.Screen
      options={{ unstable_headerRightItems: Platform.OS === 'ios' ? () => [item] : undefined }}
    />
  )
}

const MemoryEditor = ({
  entry,
  memoryKey,
  onSaved,
  onClose,
}: {
  entry: MemoryEntry
  memoryKey: MemoryKey
  onSaved: () => void
  onClose: () => void
}) => {
  const { api } = useAuth()
  const [description, setDescription] = useState(entry.description)
  const [type, setType] = useState<EMemoryType>(entry.type)
  const [body, setBody] = useState(entry.body)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const dirty = description !== entry.description || type !== entry.type || body !== entry.body

  const handleSave = async () => {
    if (api === undefined || !dirty || saving) return
    setSaving(true)
    setFailure(null)
    try {
      await saveMemoryEntry({ api, key: memoryKey, description, type, body })
      onSaved()
    } catch {
      setFailure('This memory could not be saved. Reload and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SaveButton enabled={dirty && !saving} onPress={() => void handleSave()} />
      <Section title="Description">
        <View style={styles.field}>
          <Input
            value={description}
            onChangeText={setDescription}
            multiline
            accessibilityLabel="Memory description"
            maxLength={MEMORY_MAX_DESCRIPTION_CHARS}
          />
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {`${description.length} / ${MEMORY_MAX_DESCRIPTION_CHARS}`}
          </Text>
        </View>
      </Section>
      <Section title="Type">
        <ChoiceRow
          label="Type"
          value={type}
          options={MEMORY_TYPE_OPTIONS}
          onChange={(next: EMemoryType) => setType(next)}
        />
      </Section>
      <Section title="Body">
        <View style={styles.field}>
          <Input
            value={body}
            onChangeText={setBody}
            multiline
            accessibilityLabel="Memory body"
            maxLength={MEMORY_MAX_BODY_CHARS}
            style={styles.body}
          />
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {`${body.length} / ${MEMORY_MAX_BODY_CHARS}`}
          </Text>
        </View>
      </Section>
      <Button
        label="Save"
        stretch
        loading={saving}
        disabled={!dirty || saving}
        onPress={() => void handleSave()}
      />
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      <Button label="Cancel" stretch variant={EButtonVariant.Outline} onPress={onClose} />
    </>
  )
}

const MemoryReader = ({
  entry,
  memoryKey,
  onEdit,
}: {
  entry: MemoryEntry
  memoryKey: MemoryKey
  onEdit: () => void
}) => {
  const { api } = useAuth()

  const handleDelete = () => {
    confirmAction({
      title: `Delete ${entry.name}?`,
      message: 'The agent stops seeing this memory in new threads. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        if (api === undefined) return
        void deleteMemoryEntry({ api, key: memoryKey }).then(
          () => router.back(),
          () => undefined,
        )
      },
    })
  }

  return (
    <>
      <Section title="Memory">
        <Row label="Type" value={MEMORY_TYPE_LABELS[entry.type]} />
        <Row label="Name" value={entry.name} mono />
        <Row label="Revision" value={String(entry.revision)} />
        <Row label="Updated" value={formatMemoryDate(entry.updatedAt)} />
      </Section>
      <Section title="Description">
        <Text size={ETextRole.Sm} style={styles.padded}>
          {entry.description}
        </Text>
      </Section>
      {entry.body.trim() === '' ? null : (
        <Section title="Body">
          <View style={styles.padded}>
            <Markdown value={entry.body} selectable />
          </View>
        </Section>
      )}
      <Section>
        <ActionRow label="Edit" onPress={onEdit} />
        <ActionRow label="Delete" tone={EActionTone.Destructive} onPress={handleDelete} />
      </Section>
    </>
  )
}

export default function MemoryEntryScreen() {
  const { api } = useAuth()
  const params = useLocalSearchParams<{
    mode?: string
    scope?: string
    name?: string
    project?: string
    groupId?: string
  }>()
  const name = params.name ?? ''
  const scope = scopeOf(params.scope ?? '')
  const project = optionalOf(params.project)
  const groupId = optionalOf(params.groupId)
  const [editing, setEditing] = useState(params.mode === 'edit')
  const memoryKey: MemoryKey = { scope, project, groupId, name }
  const { state, data, reload } = useApiResource({
    load: () =>
      api === undefined || name === ''
        ? Promise.resolve(null)
        : loadMemoryEntry({ api, key: memoryKey }).catch(() => null),
    deps: [api, name, scope, project, groupId],
  })

  return (
    <SettingsScroll>
      <Stack.Screen options={{ headerLeft: () => <CloseButton /> }} />
      <StatusRows state={state} onRetry={reload} failure="This memory could not be loaded." />
      {data === null ? null : editing ? (
        <MemoryEditor
          key={data.name}
          entry={data}
          memoryKey={memoryKey}
          onSaved={() => setEditing(false)}
          onClose={() => setEditing(false)}
        />
      ) : (
        <MemoryReader
          key={data.name}
          entry={data}
          memoryKey={memoryKey}
          onEdit={() => setEditing(true)}
        />
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  field: {
    gap: space(1.5),
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
  body: {
    minHeight: 220,
  },
  padded: {
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
})
