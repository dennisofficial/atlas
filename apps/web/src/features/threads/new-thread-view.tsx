'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useRef, useState } from 'react'
import { FolderXIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import type { Project } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/workspace/query-gate'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { createThread, fetchProjects } from './data/threads-api'
import { threadTitleOf } from './data/transcript'
import { useSend } from './data/use-send'
import { NotConfiguredAlert } from './not-configured-alert'
import { ProjectSelect } from './project-select'
import { ThreadComposer } from './thread-composer'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

function NoProjects() {
  return (
    <Empty className="border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderXIcon />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>Atlas runs each thread against a project.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/projects?new=1" />}>
          New project
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function Welcome({ projects }: { projects: readonly Project[] }) {
  const router = useRouter()
  const { sending, notConfigured, send } = useSend()
  const preselected = useSearchParams().get('project')
  const [selected, setSelected] = useState<string | null>(() =>
    projects.some((project) => project.id === preselected) ? preselected : null,
  )
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const thread = useRef<{ projectId: string; threadId: string } | null>(null)
  const projectId = selected ?? projects[0]?.id ?? null

  const handleProjectChange = (next: string) => setSelected(next)

  const handleSubmit = async (text: string) => {
    if (projectId === null) return
    setCreating(true)
    try {
      if (thread.current?.projectId !== projectId) {
        const created = await createThread({ projectId, title: threadTitleOf(text) })
        thread.current = { projectId, threadId: created.id }
      }
      const { threadId } = thread.current
      const sent = await send({ threadId, projectId, text })
      if (sent) router.push(`/threads/${encodeURIComponent(threadId)}`)
      else setDraft(text)
    } catch (failure) {
      toast.error(messageOf(failure))
      setDraft(text)
    } finally {
      setCreating(false)
    }
  }

  if (projectId === null) return <NoProjects />

  return (
    <>
      <ThreadComposer
        value={draft}
        onValueChange={setDraft}
        onSubmit={handleSubmit}
        disabled={creating || sending}
        placeholder="Describe a task for Atlas…"
      >
        <div className="ml-auto flex min-w-0">
          <ProjectSelect
            projects={projects}
            projectId={projectId}
            onProjectChange={handleProjectChange}
          />
        </div>
      </ThreadComposer>
      {notConfigured === null ? null : <NotConfiguredAlert error={notConfigured} />}
    </>
  )
}

export function NewThreadView() {
  const query = useCloudQuery({ key: 'projects', load: fetchProjects })
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-5 px-4 py-16">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-medium tracking-tight">What should Atlas work on?</h1>
        <Button variant="link" size="sm" nativeButton={false} render={<Link href="/projects" />}>
          Projects
        </Button>
      </div>
      <QueryGate query={query} label="projects">
        {(projects) => (
          <Suspense>
            <Welcome projects={projects} />
          </Suspense>
        )}
      </QueryGate>
    </main>
  )
}
