import {
  Button,
  EButtonSize,
  EFontWeight,
  ETextRole,
  ETextTone,
  Input,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { randomUUID } from 'expo-crypto'
import { router, useLocalSearchParams } from 'expo-router'
import { ArrowUp } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { createSession } from '../../composer/create-session'
import { type IProjectOption, ProjectChips } from '../../composer/project-chips'

export default function NewSessionScreen() {
  const theme = useTheme()
  const { api } = useAuth()
  const { project } = useLocalSearchParams<{ project?: string }>()
  const [projects, setProjects] = useState<IProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(project ?? null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendId = useRef(randomUUID())

  useEffect(() => {
    if (api === undefined) return
    void api.projects.list.query().then((list) => {
      setProjects(list.map(({ id, name }) => ({ id, name })))
      setProjectId((current) =>
        current !== null && list.some((entry) => entry.id === current)
          ? current
          : (list[0]?.id ?? null),
      )
    })
  }, [api])

  const text = draft.trim()
  const canSend = api !== undefined && projectId !== null && text.length > 0 && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const id = await createSession({ api, projectId, text, sendId: sendId.current })
      router.replace({ pathname: '/thread/[id]', params: { id } })
    } catch {
      setError('The session could not be started. Try again.')
      setSending(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <View style={styles.center}>
        <Text size={ETextRole.Xl} weight={EFontWeight.Medium} tight style={styles.heading}>
          What should Atlas work on?
        </Text>
        <View
          style={[
            styles.composer,
            {
              backgroundColor: theme.card,
              borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
            },
          ]}
        >
          <Input
            bare
            accessibilityLabel="Describe a task"
            autoFocus
            multiline
            placeholder="Describe a task for Atlas…"
            value={draft}
            onChangeText={setDraft}
            style={styles.input}
          />
          <View style={styles.footer}>
            <View style={styles.chips}>
              <ProjectChips projects={projects} selectedId={projectId} onSelect={setProjectId} />
            </View>
            <Button
              label="Start session"
              icon={ArrowUp}
              size={EButtonSize.IconSm}
              disabled={!canSend}
              loading={sending}
              onPress={() => void handleSend()}
            />
          </View>
        </View>
        {error !== null ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.heading}>
            {error}
          </Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: space(4),
  },
  center: {
    flex: 1,
    gap: space(5),
    justifyContent: 'center',
  },
  heading: {
    textAlign: 'center',
  },
  composer: {
    borderRadius: radius(1.4),
    borderWidth: 1,
    gap: space(2),
    padding: space(2.5),
  },
  input: {
    maxHeight: 200,
    minHeight: 56,
    paddingHorizontal: space(0.5),
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  chips: {
    flex: 1,
  },
})
