import type { Attachment } from '@dltech/atlas-core'
import { EFontWeight, ETextRole, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { createSession } from '../../composer/create-session'
import type { IProjectOption } from '../../composer/project-options'
import { ProjectSelect } from '../../composer/project-select'
import { Composer } from '../../thread/composer/composer'

export default function NewSessionScreen() {
  const theme = useTheme()
  const { api } = useAuth()
  const { project } = useLocalSearchParams<{ project?: string }>()
  const [projects, setProjects] = useState<IProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(project ?? null)

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

  const handleSend = async (message: {
    text: string
    attachments: Attachment[]
  }): Promise<boolean> => {
    if (api === undefined || projectId === null) return false
    try {
      const id = await createSession({ api, projectId, text: message.text })
      router.replace({ pathname: '/sessions/[id]', params: { id } })
      return true
    } catch {
      return false
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
        <Composer
          autoFocus
          working={false}
          sendable={projectId !== null}
          placeholder="Describe a task for Atlas…"
          onSend={handleSend}
        >
          <View style={styles.project}>
            <ProjectSelect
              projects={projects}
              projectId={projectId}
              onProjectChange={setProjectId}
            />
          </View>
        </Composer>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  heading: {
    marginBottom: space(3),
    paddingHorizontal: space(4),
    textAlign: 'center',
  },
  project: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
})
