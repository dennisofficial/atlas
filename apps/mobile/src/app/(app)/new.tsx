import { randomUUID } from 'expo-crypto'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { Icon } from '../../components/icon'
import { createSession } from '../../composer/create-session'
import { type IProjectOption, ProjectChips } from '../../composer/project-chips'
import { useTheme } from '../../theme/use-theme'

export default function NewSessionScreen() {
  const theme = useTheme()
  const { api } = useAuth()
  const [projects, setProjects] = useState<IProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendId = useRef(randomUUID())

  useEffect(() => {
    if (api === undefined) return
    void api.projects.list.query().then((list) => {
      setProjects(list.map(({ id, name }) => ({ id, name })))
      setProjectId((current) => current ?? list[0]?.id ?? null)
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
        <Text style={[styles.heading, { color: theme.foreground }]}>
          What should Atlas work on?
        </Text>
      </View>
      <View style={[styles.composer, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <TextInput
          accessibilityLabel="Describe a task"
          autoFocus
          multiline
          placeholder="Describe a task for Atlas…"
          placeholderTextColor={theme.mutedForeground}
          value={draft}
          onChangeText={setDraft}
          style={[styles.input, { color: theme.foreground }]}
        />
        <View style={styles.footer}>
          <View style={styles.chips}>
            <ProjectChips projects={projects} selectedId={projectId} onSelect={setProjectId} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start session"
            disabled={!canSend}
            onPress={() => void handleSend()}
            style={[styles.send, { backgroundColor: canSend ? theme.primary : theme.muted }]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={theme.primaryForeground} />
            ) : (
              <Icon
                ios="arrow.up"
                web="arrow_upward"
                color={canSend ? theme.primaryForeground : theme.mutedForeground}
                size={18}
              />
            )}
          </Pressable>
        </View>
      </View>
      {error !== null ? (
        <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>
      ) : null}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  heading: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  composer: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 12,
  },
  input: {
    fontSize: 16,
    maxHeight: 200,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  chips: {
    flex: 1,
  },
  send: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  error: {
    marginTop: 8,
    textAlign: 'center',
  },
})
