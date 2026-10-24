'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { Project } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/workspace/query-gate'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { createThreadBodyOf } from './data/create-thread'
import { createFieldsOf, defaultSelectionOf, type ModelSelection } from './data/model-selection'
import { createThread, fetchProjects } from './data/threads-api'
import { useModelPicker } from './data/use-model-picker'
import { messageOf } from './data/use-send'
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
  const [creating, setCreating] = useState(false)
  const attempt = useRef<{ text: string; projectId: string | null; sendId: string } | null>(null)
  const projectId = selected === undefined ? (projects[0]?.id ?? null) : selected

  const handleProjectChange = (next: string | null) => setSelected(next)

  const handleSubmit = async (text: string) => {
    const sendId =
      attempt.current?.text === text && attempt.current.projectId === projectId
        ? attempt.current.sendId
        : crypto.randomUUID()
    attempt.current = { text, projectId, sendId }
    setCreating(true)
    try {
      const { thread } = await createThread(
        createThreadBodyOf({ projectId, text, sendId, ...createFieldsOf(selection) }),
      )
      attempt.current = null
      router.push(`/threads/${encodeURIComponent(thread.id)}`)
    } catch (failure) {
      toast.error(messageOf(failure))
      setDraft(text)
      setCreating(false)
    }
  }

  return (
    <ThreadComposer
      value={draft}
      onValueChange={setDraft}
      onSubmit={handleSubmit}
      disabled={creating}
      placeholder="Describe a task for Atlas…"
    >
      <ModelPickerControls picker={picker} selection={selection} onSelectionChange={setChosen} />
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
