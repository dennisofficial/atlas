import { initialProjectIdOf } from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'
import { EFontWeight, ETextRole, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, useLocalSearchParams, usePathname } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { z } from 'zod'

import { useAuth } from '../../auth/auth-provider'
import { createSession } from '../../composer/create-session'
import { EffortSelect } from '../../composer/effort-select'
import { FastToggle } from '../../composer/model-controls'
import {
  defaultModelIdOf,
  effortChoicesOf,
  type IModelSelection,
  knownEffortOf,
  selectionOf,
} from '../../composer/model-options'
import { ModelSelect } from '../../composer/model-picker'
import type { IProjectOption } from '../../composer/project-options'
import { ProjectSelect } from '../../composer/project-select'
import { headingFitsOf } from '../../composer/new-session-heading'
import { useModels } from '../../composer/use-models'
import { KeyboardDock } from '../../layout/keyboard-dock'
import { applyNavigation } from '../../navigation/apply-navigation'
import { sessionOpenOf } from '../../navigation/root-navigation'
import { useSettings } from '../../settings/settings-provider'
import { kvJsonStore } from '../../storage/kv-json-store'
import { Composer } from '../../thread/composer/composer'
import { newSessionProjectOf } from '../../thread/composer/new-session-project'
import { useAttachments } from '../../thread/composer/use-attachments'

const NewSession = () => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [available, setAvailable] = useState(0)
  const [headingHeight, setHeadingHeight] = useState(0)
  const [composerHeight, setComposerHeight] = useState(0)
  const headingFits = headingFitsOf({
    available,
    heading: headingHeight,
    composer: composerHeight,
  })
  const { api } = useAuth()
  const pathname = usePathname()
  const { project } = useLocalSearchParams<{ project?: string }>()
  const projectStore = useMemo(
    () => newSessionProjectOf(kvJsonStore({ database: 'atlas-composer' })),
    [],
  )
  const [projects, setProjects] = useState<IProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(project ?? null)
  const [modelId, setModelId] = useState<string | null>(null)
  const [effort, setEffort] = useState<string | null>(null)
  const [fast, setFast] = useState<boolean | null>(null)
  const { models, ready: modelsReady } = useModels()
  const attachments = useAttachments()
  const settings = useSettings()
  const personalId = settings.read({ key: 'model.id', schema: z.string() })
  const selection = selectionOf({
    models,
    modelId: modelId ?? defaultModelIdOf({ models, personalId }),
    effort: effort ?? knownEffortOf(settings.read({ key: 'model.effort', schema: z.string() })),
    fast: fast ?? settings.read({ key: 'model.fast', schema: z.boolean() }),
  })
  const efforts = effortChoicesOf(selection)
  const projectName = projects.find((entry) => entry.id === projectId)?.name ?? null

  useEffect(() => {
    if (api === undefined) return
    void Promise.all([api.projects.list.query(), projectStore.load()]).then(([list, stored]) => {
      setProjects(list.map(({ id, name }) => ({ id, name })))
      setProjectId((current) =>
        initialProjectIdOf({ projects: list, preselected: current ?? stored }),
      )
    })
  }, [api, projectStore])

  const handleModelSelect = (next: IModelSelection) => {
    setModelId(next.model.id)
    setEffort(next.effort)
    setFast(next.fast)
  }

  const handleEffortSelect = (name: string) => setEffort(name)

  const handleFastToggle = (next: boolean) => setFast(next)

  const handleProjectChange = (next: string | null) => {
    setProjectId(next)
    projectStore.save(next)
  }

  const handleCenterLayout = (event: LayoutChangeEvent) =>
    setAvailable(event.nativeEvent.layout.height)

  const handleHeadingLayout = (event: LayoutChangeEvent) =>
    setHeadingHeight(event.nativeEvent.layout.height)

  const handleComposerLayout = (event: LayoutChangeEvent) =>
    setComposerHeight(event.nativeEvent.layout.height)

  const handleSend = async (message: {
    text: string
    attachments: Attachment[]
  }): Promise<boolean> => {
    if (api === undefined) return false
    try {
      const id = await createSession({
        api,
        projectId,
        text: message.text,
        attachments: message.attachments,
        model: selection?.model.id,
        effort: selection?.effort,
        fast: selection?.fast,
      })
      router.dismiss()
      applyNavigation(sessionOpenOf({ pathname, id }))
      return true
    } catch {
      return false
    }
  }

  return (
    <KeyboardDock
      style={[
        styles.screen,
        {
          backgroundColor: theme.background,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingTop: insets.top,
        },
      ]}
    >
      <View style={styles.center} onLayout={handleCenterLayout}>
        <View
          pointerEvents={headingFits ? 'auto' : 'none'}
          style={headingFits ? styles.headingSlot : styles.hiddenHeadingSlot}
          onLayout={handleHeadingLayout}
        >
          <Text size={ETextRole.Xxl} weight={EFontWeight.Medium} tight style={styles.heading}>
            What should we work on
            {projectName === null ? null : (
              <>
                {' in '}
                <Text
                  size={ETextRole.Xxl}
                  weight={EFontWeight.Semibold}
                  tight
                  color={theme.primary}
                >
                  {projectName}
                </Text>
              </>
            )}
            ?
          </Text>
        </View>
        <View onLayout={handleComposerLayout}>
          <Composer
            autoFocus
            working={false}
            sendable={api !== undefined}
            placeholder="Describe a task for Atlas…"
            draftSessionId={null}
            attachments={attachments}
            onSend={handleSend}
            trailing={
              <ProjectSelect
                projects={projects}
                projectId={projectId}
                onProjectChange={handleProjectChange}
              />
            }
          >
            <View style={styles.footer}>
              {modelsReady && settings.ready ? (
                <ModelSelect models={models} selection={selection} onSelect={handleModelSelect} />
              ) : null}
              {selection === null || efforts.length === 0 ? null : (
                <EffortSelect selection={selection} onChange={handleEffortSelect} />
              )}
              {selection?.model.fast === true ? (
                <FastToggle selection={selection} onToggle={handleFastToggle} />
              ) : null}
            </View>
          </Composer>
        </View>
      </View>
    </KeyboardDock>
  )
}

export default function NewSessionScreen() {
  return (
    <SafeAreaProvider>
      <NewSession />
    </SafeAreaProvider>
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
  headingSlot: {
    paddingBottom: space(3),
  },
  hiddenHeadingSlot: {
    left: 0,
    opacity: 0,
    paddingBottom: space(3),
    position: 'absolute',
    right: 0,
    top: 0,
  },
  heading: {
    paddingHorizontal: space(4),
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
})
