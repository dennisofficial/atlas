'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SaidUpload } from '@dltech/atlas-core'
import type { Project, SaidImageWire } from '@dltech/atlas-wire/web'

import { createLocalThread, newLocalThreadId } from '@/features/desktop/create-local-thread'
import { ERunnerChoice, RunnerToggle } from '@/features/desktop/runner-toggle'
import { useDesktop } from '@/features/desktop/use-desktop'
import { createSessionWithMessage } from '@/features/sessions/data/create-session'
import { sessionsApi } from '@/features/sessions/data/sessions-api'
import { useSessionAttachments } from '@/features/sessions/data/use-session-attachments'
import { EEngine, EngineToggle } from '@/features/sessions/engine-toggle'
import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { NewThreadSkeleton } from '@/features/projects/project-skeletons'
import { createdThreads } from '@/features/shell/created-threads'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { useNewThreadCommands } from './commands/use-new-thread-commands'
import { createThreadBodyOf } from './data/create-thread'
import { createFieldsOf, defaultSelectionOf, type ModelSelection } from './data/model-selection'
import { PROJECTS_KEY, SHELL_THREADS_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

import { createThread, fetchProjects } from './data/threads-api'
import { NEW_THREAD_DRAFT_SCOPE } from './data/composer-drafts-api'
import { useComposerAttachments } from './data/use-composer-attachments'
import { useComposerDraft } from './data/use-composer-draft'
import { useModelPicker } from './data/use-model-picker'
import { isRetryOf, messageOf } from './data/use-send'
import { ModelPickerControls } from './model-picker'
import { ProjectSelect } from './project-select'
import { ThreadComposer } from './thread-composer'

function Welcome({ projects }: { projects: readonly Project[] }) {
  const router = useRouter()
  const invalidateCloud = useInvalidateCloud()
  const preselected = useSearchParams().get('project')
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
  const preselectedId = projects.some((project) => project.id === preselected) ? preselected : null
  const [draft, setDraft] = useState('')
  const [chosen, setChosen] = useState<ModelSelection | null>(null)
  const picker = useModelPicker()
  const selection =
    chosen ??
    defaultSelectionOf({
      models: picker.options.models,
      personalId: picker.personalId,
      personalEffort: picker.personalEffort,
      personalFast: picker.personalFast,
    })
  const images = useComposerAttachments()
  const session = useSessionAttachments({ files: images })
  const drafts = useComposerDraft({
    scope: NEW_THREAD_DRAFT_SCOPE,
    text: draft,
    uploads: images.uploads,
    onRestore: (stored) => {
      setDraft(stored.text)
      images.restore({ uploads: stored.uploads, images: [] })
    },
  })
  const [creating, setCreating] = useState(false)
  const desktop = useDesktop()
  const [runner, setRunner] = useState(ERunnerChoice.Cloud)
  const [engine, setEngine] = useState(EEngine.V1)
  const attempt = useRef<{
    text: string
    images: SaidImageWire[]
    uploads: SaidUpload[]
    projectId: string | null
    sendId: string
  } | null>(null)
  const projectId = selected === undefined ? (preselectedId ?? projects[0]?.id ?? null) : selected
  const local =
    desktop.present && desktop.docker && runner === ERunnerChoice.ThisMac && projectId !== null
  const onThisMac = desktop.present && runner === ERunnerChoice.ThisMac
  const v2 = engine === EEngine.V2 && !onThisMac

  const clearDraft = useCallback(() => setDraft(''), [])
  const commands = useNewThreadCommands({ projectId, clearDraft })

  const handleProjectChange = (next: string | null) => setSelected(next)

  const handleSubmit = async (text: string) => {
    if (await commands.handleCommand(text)) {
      setDraft('')
      return
    }
    if (v2) {
      await handleSubmitV2(text)
      return
    }
    if (!images.checkSendable()) return
    const held = images.images
    const uploads = images.uploads
    const sendId =
      attempt.current?.projectId === projectId &&
      isRetryOf({ previous: attempt.current, text, images: held, uploads })
        ? attempt.current.sendId
        : crypto.randomUUID()
    attempt.current = { text, images: held, uploads, projectId, sendId }
    setCreating(true)
    try {
      if (local && projectId !== null) {
        const id = await createLocalThread({
          threadId: newLocalThreadId(),
          projectId,
          ...createFieldsOf(selection),
          text,
          sendId,
          images: held,
          uploads,
        })
        attempt.current = null
        images.clear()
        drafts.handleSent(text)
        router.push(`/threads/${encodeURIComponent(id)}`)
        return
      }
      const { thread } = await createThread(
        createThreadBodyOf({
          projectId,
          text,
          sendId,
          images: held,
          uploads,
          ...createFieldsOf(selection),
        }),
      )
      attempt.current = null
      images.clear()
      drafts.handleSent(text)
      createdThreads.announce(thread)
      void invalidateCloud([SHELL_THREADS_KEY])
      router.push(`/threads/${encodeURIComponent(thread.id)}`)
    } catch (failure) {
      toast.error(messageOf(failure))
      setCreating(false)
    }
  }

  const handleSubmitV2 = async (text: string) => {
    if (projectId === null) {
      toast.error('Pick a project for a v2 session')
      return
    }
    if (!session.checkSendable()) return
    const { media, uploads } = session
    if (text.trim().length === 0 && media.length === 0 && uploads.length === 0) return
    setCreating(true)
    try {
      const sessionId = await createSessionWithMessage({
        api: sessionsApi,
        projectId,
        text,
        media,
        uploads,
      })
      session.clear()
      drafts.handleSent(text)
      router.push(`/sessions/${encodeURIComponent(sessionId)}`)
    } catch (failure) {
      toast.error(messageOf(failure))
      setCreating(false)
    }
  }

  return (
    <ThreadComposer
      value={draft}
      onValueChange={setDraft}
      onSubmit={handleSubmit}
      sending={creating || (v2 ? session.uploading : images.uploading)}
      {...(v2 ? session.composerProps : images.composerProps)}
      sendsAttachmentsAlone={v2}
      commandSpecs={commands.specs}
      placeholder="Describe a task for Atlas…"
    >
      <RunnerToggle desktop={desktop} value={runner} onValueChange={setRunner} />
      {onThisMac ? null : <EngineToggle value={engine} onValueChange={setEngine} />}
      <ModelPickerControls
        picker={picker}
        selection={selection}
        onSelectionChange={setChosen}
        open={commands.modelOpen}
        onOpenChange={commands.setModelOpen}
      />
      <div className="ml-auto flex min-w-0">
        <ProjectSelect
          projects={projects}
          projectId={projectId}
          onProjectChange={handleProjectChange}
        />
      </div>
    </ThreadComposer>
  )
}

export function NewThreadView() {
  const query = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-5 px-4 py-16">
        <h1 className="text-center text-xl font-medium tracking-tight">
          What should Atlas work on?
        </h1>
        <QueryGate query={query} label="projects" skeleton={<NewThreadSkeleton />}>
          {(projects) => (
            <Suspense>
              <Welcome projects={projects} />
            </Suspense>
          )}
        </QueryGate>
      </div>
    </div>
  )
}
