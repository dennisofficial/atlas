import type { CreateProjectBody } from '@/features/project-settings/data/project-api'

import type { SecretPair } from './new-project-secrets'

export interface SubmissionProgress {
  projectId: string | null
  remaining: readonly SecretPair[]
}

export async function submitProject({
  body,
  progress,
  createProject,
  putSecret,
}: {
  body: CreateProjectBody
  progress: SubmissionProgress
  createProject: (body: CreateProjectBody) => Promise<{ id: string }>
  putSecret: (args: SecretPair & { projectId: string }) => Promise<void>
}): Promise<void> {
  if (progress.projectId === null) {
    progress.projectId = (await createProject(body)).id
  }
  while (progress.remaining.length > 0) {
    const pair = progress.remaining[0]
    if (!pair) return
    await putSecret({ projectId: progress.projectId, ...pair })
    progress.remaining = progress.remaining.slice(1)
  }
}
