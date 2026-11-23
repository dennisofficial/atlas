import { useCallback, useRef, useState } from 'react'

import { sessionCreateInputOf } from '@dltech/atlas-client/session'
import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import type { SessionModelChoice } from '@dltech/atlas-protocol'

import type { ProjectAnswer, ProjectRequest } from '../ui/project-prompt-model'
import type { ProjectPromptControl } from '../ui/hooks/use-project-prompt'
import { firstMessageOf, resolveProjectOf, type GitRemote } from './new-session'
import { readOriginUrl, remoteDefaultBranch } from './git-remote'
import type { SessionApi } from './session-api'

export type NewSessionControl = {
  prompt: ProjectPromptControl
  creating: boolean
  handleCreate: (args: {
    text: string
    media: readonly Attachment[]
    uploads: readonly SaidUpload[]
  }) => Promise<void>
}

const GIT_REMOTE: GitRemote = {
  readOriginUrl: (args) => readOriginUrl(args),
  remoteDefaultBranch: (args) => remoteDefaultBranch(args),
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useNewSession(args: {
  api: SessionApi
  cwd: string
  model: SessionModelChoice | null
  ask: (request: ProjectRequest) => Promise<ProjectAnswer>
  prompt: ProjectPromptControl
  git?: GitRemote | undefined
  onCreated: (created: { sessionId: string; model: SessionModelChoice | null }) => void
  onProblem: (reason: string) => void
}): NewSessionControl {
  const creating = useRef(false)
  const [busy, setBusy] = useState(false)
  const latest = useRef(args)
  latest.current = args

  const handleCreate = useCallback(
    async (message: {
      text: string
      media: readonly Attachment[]
      uploads: readonly SaidUpload[]
    }): Promise<void> => {
      if (creating.current) return
      creating.current = true
      setBusy(true)

      const { api, cwd, model, ask, prompt, onCreated, onProblem } = latest.current
      const git = latest.current.git ?? GIT_REMOTE

      try {
        const resolved = await resolveProjectOf({
          cwd,
          projects: api,
          git,
          ask,
          isMounted: prompt.isMounted,
        })
        if (resolved === 'cancelled') return

        const created = await api.createSession(
          sessionCreateInputOf({
            projectId: resolved.projectId,
            ...(model === null
              ? {}
              : { model: model.ref, effort: model.effort, fast: model.fast ? true : undefined }),
            firstMessage: firstMessageOf(message),
          }),
        )
        onCreated({ sessionId: created.sessionId, model })
      } catch (failure) {
        onProblem(messageOf(failure))
      } finally {
        creating.current = false
        setBusy(false)
      }
    },
    [],
  )

  return { prompt: args.prompt, creating: busy, handleCreate }
}
