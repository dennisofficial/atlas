'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useState } from 'react'
import { toast } from 'sonner'

import { initialProjectIdOf } from '@dltech/atlas-client/session'
import type { Project } from '@dltech/atlas-wire/web'

import { fetchProjects } from '@/features/projects/data/projects-api'
import { NewThreadSkeleton } from '@/features/projects/project-skeletons'
import { createSessionWithMessage } from '@/features/sessions/data/create-session'
import { useDraftAttachments } from '@/features/sessions/data/use-draft-attachments'
import { useSessionAttachments } from '@/features/sessions/data/use-session-attachments'
import { useSessionDraft } from '@/features/sessions/data/use-session-draft'
import { sessionStream } from '@/features/sessions/data/session-stream'
import { sessionsApi } from '@/features/sessions/data/sessions-api'
import { DEFAULT_RUNTIME, RuntimeMenu, runtimeTargetOf } from '@/features/sessions/runtime-menu'
import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { useNewThreadCommands } from './commands/use-new-thread-commands'
import { createFieldsOf, defaultSelectionOf, type ModelSelection } from './data/model-selection'
import { useComposerAttachments } from './data/use-composer-attachments'
import { useModelPicker } from './data/use-model-picker'
import { messageOf } from './data/message-of'
import { ModelPickerControls } from './model-picker'
import { NewThreadHero } from './new-thread-hero'
import { ProjectSelect } from './project-select'
import { ThreadComposer } from './thread-composer'

function Welcome({ projects }: { projects: readonly Project[] }) {
  const router = useRouter()
  const preselected = useSearchParams().get('project')
  const [selected, setSelected] = useState<string | null | undefined>(undefined)
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
  const files = useComposerAttachments()
  const session = useSessionAttachments({ files })
  const draftAttachments = useDraftAttachments({
    media: session.media,
    uploads: session.uploads,
  })
  const drafts = useSessionDraft({
    sessionId: null,
    text: draft,
    attachments: draftAttachments,
    onRestore: (stored) => {
      setDraft(stored.text)
      session.restore({
        attachments: stored.attachments,
        previewOf: () => Promise.reject(new Error('no media preview before a session exists')),
      })
    },
  })
  const [creating, setCreating] = useState(false)
  const [runtime, setRuntime] = useState(DEFAULT_RUNTIME)
  const target = runtimeTargetOf(runtime)
  const projectId =
    selected === undefined ? initialProjectIdOf({ projects, preselected }) : selected
  const projectName = projects.find((project) => project.id === projectId)?.name ?? null

  const clearDraft = useCallback(() => setDraft(''), [])
  const commands = useNewThreadCommands({ clearDraft })

  const handleProjectChange = (next: string | null) => setSelected(next)

  const handleSubmit = async (text: string) => {
    if (await commands.handleCommand(text)) {
      setDraft('')
      return
    }
    if (!session.checkSendable()) return
    const { media, uploads } = session
    if (text.trim().length === 0 && media.length === 0 && uploads.length === 0) return
    setCreating(true)
    void sessionStream()
    void import('@/features/sessions/session-view')
    try {
      const sessionId = await createSessionWithMessage({
        api: sessionsApi,
        projectId,
        text,
        media,
        uploads,
        ...createFieldsOf(selection),
        provider: target.provider,
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
    <>
      <NewThreadHero projectName={projectName} />
      <ThreadComposer
        value={draft}
        onValueChange={setDraft}
        onSubmit={handleSubmit}
        sending={creating}
        {...session.composerProps}
        sendsAttachmentsAlone
        entries={commands.entries}
        placeholder="Describe a task for Atlas…"
      >
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
          <RuntimeMenu value={runtime} onValueChange={setRuntime} />
        </div>
      </ThreadComposer>
    </>
  )
}

export function NewThreadView() {
  const query = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 px-4 py-16">
        <QueryGate
          query={query}
          label="projects"
          skeleton={
            <>
              <NewThreadHero projectName={null} />
              <NewThreadSkeleton />
            </>
          }
        >
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
