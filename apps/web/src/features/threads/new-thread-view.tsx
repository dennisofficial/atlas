'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SaidUpload } from '@dltech/atlas-core'
import type { Project, SaidImageWire } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { createdThreads } from '@/features/shell/created-threads'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { useNewThreadCommands } from './commands/use-new-thread-commands'
import { createThreadBodyOf } from './data/create-thread'
import { createFieldsOf, defaultSelectionOf, type ModelSelection } from './data/model-selection'
import { createThread, fetchProjects } from './data/threads-api'
import { useComposerAttachments } from './data/use-composer-attachments'
import { useModelPicker } from './data/use-model-picker'
import { isRetryOf, messageOf } from './data/use-send'
import { ModelPickerControls } from './model-picker'
import { ProjectSelect } from './project-select'
import { ThreadComposer } from './thread-composer'

function Welcome({ projects }: { projects: readonly Project[] }) {
  const router = useRouter()
  const preselected = useSearchParams().get('project')
  const [selected, setSelected] = useState<string | null | undefined>(() =>
    projects.some((project) => project.id === preselected) ? preselected : undefined,
  )
  const [draft, setDraft] = useState('')
  const [chosen, setChosen] = useState<ModelSelection | null>(null)
  const picker = useModelPicker()
  const selection =
    chosen ??
    defaultSelectionOf({
      models: picker.options.models,
      personalId: picker.personalId,
      personalEffort: picker.personalEffort,
    })
  const images = useComposerAttachments()
  const [creating, setCreating] = useState(false)
  const attempt = useRef<{
    text: string
    images: SaidImageWire[]
    uploads: SaidUpload[]
    projectId: string | null
    sendId: string
  } | null>(null)
  const projectId = selected === undefined ? (projects[0]?.id ?? null) : selected

  const clearDraft = useCallback(() => setDraft(''), [])
  const commands = useNewThreadCommands({ projectId, clearDraft })

  const handleProjectChange = (next: string | null) => setSelected(next)

  const handleSubmit = async (text: string) => {
    if (await commands.handleCommand(text)) {
      setDraft('')
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
      createdThreads.announce(thread)
      router.push(`/threads/${encodeURIComponent(thread.id)}`)
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
      sending={creating || images.uploading}
      {...images.composerProps}
      commandSpecs={commands.specs}
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
      </div>
    </ThreadComposer>
  )
}

export function NewThreadView() {
  const query = useCloudQuery({ key: 'projects', load: fetchProjects })
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-5 px-4 py-16">
        <h1 className="text-center text-xl font-medium tracking-tight">
          What should Atlas work on?
        </h1>
        <QueryGate query={query} label="projects">
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
