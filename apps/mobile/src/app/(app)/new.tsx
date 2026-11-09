import type { Attachment } from '@dltech/atlas-core'
import { EFontWeight, ETextRole, Text, useTheme } from '@dltech/atlas-ui-native'
import { decodeModelFavourites, encodeModelFavourites } from '@dltech/atlas-wire/web'
import { space } from '@dltech/atlas-ui/tokens'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { z } from 'zod'

import { useAuth } from '../../auth/auth-provider'
import { createSession } from '../../composer/create-session'
import { EffortSelect, FastToggle } from '../../composer/model-controls'
import { effortChoicesOf, type IModelSelection, selectionOf } from '../../composer/model-options'
import { ModelSelect } from '../../composer/model-picker'
import type { IProjectOption } from '../../composer/project-options'
import { ProjectSelect } from '../../composer/project-select'
import { useModels } from '../../composer/use-models'
import { useSettings } from '../../settings/settings-provider'
import { Composer } from '../../thread/composer/composer'

export default function NewSessionScreen() {
  const theme = useTheme()
  const { api } = useAuth()
  const { project } = useLocalSearchParams<{ project?: string }>()
  const [projects, setProjects] = useState<IProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(project ?? null)
  const [modelId, setModelId] = useState<string | null>(null)
  const [effort, setEffort] = useState<string | null>(null)
  const [fast, setFast] = useState(false)
  const { models } = useModels()
  const settings = useSettings()
  const [localPinned, setLocalPinned] = useState<string[] | null>(null)
  const selection = selectionOf({ models, modelId, effort, fast })
  const efforts = effortChoicesOf(selection)
  const personalId = settings.read({ key: 'model.id', schema: z.string() })
  const pinned =
    localPinned ??
    decodeModelFavourites(settings.read({ key: 'model.favourites', schema: z.string() }))

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

  const handleModelSelect = (next: IModelSelection | null) => {
    setModelId(next?.model.id ?? null)
    setEffort(next?.effort ?? null)
    setFast(next?.fast ?? false)
  }

  const handlePinnedChange = (ids: string[]) => {
    setLocalPinned(ids)
    settings
      .save({ 'model.favourites': encodeModelFavourites(ids) })
      .catch(() => setLocalPinned(null))
  }

  const handleEffortSelect = (name: string) => setEffort(name)

  const handleFastToggle = (next: boolean) => setFast(next)

  const handleSend = async (message: {
    text: string
    attachments: Attachment[]
  }): Promise<boolean> => {
    if (api === undefined || projectId === null) return false
    try {
      const id = await createSession({
        api,
        projectId,
        text: message.text,
        model: selection?.model.id,
        effort: selection?.effort,
        fast: selection?.fast,
      })
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
          <View style={styles.footer}>
            <ModelSelect
              models={models}
              selection={selection}
              pinned={pinned}
              personalId={personalId}
              onPinnedChange={handlePinnedChange}
              onSelect={handleModelSelect}
            />
            {selection === null || efforts.length === 0 ? null : (
              <EffortSelect selection={selection} onChange={handleEffortSelect} />
            )}
            {selection?.model.fast === true ? (
              <FastToggle selection={selection} onToggle={handleFastToggle} />
            ) : null}
            <View style={styles.spacer} />
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
  footer: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: space(1.5),
    minWidth: 0,
  },
  spacer: {
    flex: 1,
  },
})
