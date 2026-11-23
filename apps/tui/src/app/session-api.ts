import { httpStatusOf, type ApiClient } from '@dltech/atlas-api-router'
import type { CommandEntry } from '@dltech/atlas-commands'
import type {
  FilesReadInput,
  FilesReadOutput,
  FilesSearchInput,
  FilesSearchOutput,
  FilesTreeInput,
  FilesTreeOutput,
  MediaConfirmInput,
  MediaConfirmOutput,
  MediaPresignInput,
  MediaPresignOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionPostOutput,
  SessionRetryInput,
  SessionRetryOutput,
  SessionStopInput,
  SessionStopOutput,
  SessionWakeInput,
  SessionWakeOutput,
  SessionWithdrawInput,
  SessionWithdrawOutput,
} from '@dltech/atlas-protocol'

import type { ProjectChoice } from '../ui/project-prompt-model'
import type { AuthRefusal } from './session-client'

export type OperatorAnswerBody = Parameters<ApiClient['operatorRequests']['answer']['mutate']>[0]
export type DraftPutBody = Parameters<ApiClient['composerDrafts']['put']['mutate']>[0]
export type UploadPresignBody = Parameters<ApiClient['composerUploads']['presign']['mutate']>[0]
export type UploadPresignReply = Awaited<
  ReturnType<ApiClient['composerUploads']['presign']['mutate']>
>
export type ProjectSaveBody = Parameters<ApiClient['projects']['create']['mutate']>[0]
export type ModelsReply = Awaited<ReturnType<ApiClient['models']['list']['query']>>
export type SkillCatalogueReply = Awaited<ReturnType<ApiClient['skillCatalogue']['list']['query']>>
export type ModelsEntry = ModelsReply['providers'][number]['models'][number]
export type ModelsProvider = ModelsReply['providers'][number]

export type SessionApi = {
  post(input: SessionPostInput): Promise<SessionPostOutput>
  withdraw(input: SessionWithdrawInput): Promise<SessionWithdrawOutput>
  stop(input: SessionStopInput): Promise<SessionStopOutput>
  retry(input: SessionRetryInput): Promise<SessionRetryOutput>
  wakePod(input: SessionWakeInput): Promise<SessionWakeOutput>
  answerOperator(input: OperatorAnswerBody): Promise<void>
  presignMedia(input: MediaPresignInput): Promise<MediaPresignOutput>
  confirmMedia(input: MediaConfirmInput): Promise<MediaConfirmOutput>
  presignUpload(input: UploadPresignBody): Promise<UploadPresignReply>
  discardUpload(pathname: string): Promise<void>
  loadDraft(scope: string): Promise<string | null>
  saveDraft(input: { scope: string; text: string }): Promise<void>
  clearDraft(scope: string): Promise<void>
  treeFiles(input: FilesTreeInput): Promise<FilesTreeOutput>
  searchFiles(input: FilesSearchInput): Promise<FilesSearchOutput>
  readFile(input: FilesReadInput): Promise<FilesReadOutput>
  createSession(input: SessionCreateInput): Promise<SessionCreateOutput>
  listProjects(): Promise<readonly ProjectChoice[]>
  createProject(input: ProjectSaveBody): Promise<ProjectChoice>
  listModels(): Promise<ModelsReply>
  runCommand(input: SessionCommandInput): Promise<SessionCommandOutput>
  commands(): Promise<readonly CommandEntry[]>
  skills(): Promise<SkillCatalogueReply['skills']>
}

const authStatusOf = (failure: unknown): AuthRefusal | null => {
  const status = httpStatusOf(failure)
  return status === 401 || status === 403 ? status : null
}

export const sessionApiOf = (args: {
  api: ApiClient
  onAuthLost: (status: AuthRefusal) => void
}): SessionApi => {
  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (failure) {
      const status = authStatusOf(failure)
      if (status !== null) args.onAuthLost(status)
      throw failure
    }
  }

  return {
    post: (input) => guarded(() => args.api.sessions.post.mutate(input)),
    withdraw: (input) => guarded(() => args.api.sessions.withdraw.mutate(input)),
    stop: (input) => guarded(() => args.api.sessions.stop.mutate(input)),
    retry: (input) => guarded(() => args.api.sessions.retry.mutate(input)),
    wakePod: (input) => guarded(() => args.api.sessions.wakePod.mutate(input)),
    answerOperator: (input) => guarded(() => args.api.operatorRequests.answer.mutate(input)),
    presignMedia: (input) => guarded(() => args.api.media.presign.mutate(input)),
    confirmMedia: (input) => guarded(() => args.api.media.confirm.mutate(input)),
    presignUpload: (input) => guarded(() => args.api.composerUploads.presign.mutate(input)),
    discardUpload: async (pathname) => {
      await guarded(() => args.api.composerUploads.discard.mutate({ pathname }))
    },
    loadDraft: async (scope) => {
      const reply = await guarded(() => args.api.composerDrafts.get.query({ scope }))
      return reply.draft?.text ?? null
    },
    saveDraft: async (input) => {
      await guarded(() =>
        args.api.composerDrafts.put.mutate({ scope: input.scope, text: input.text, uploads: [] }),
      )
    },
    clearDraft: async (scope) => {
      await guarded(() => args.api.composerDrafts.clear.mutate({ scope }))
    },
    treeFiles: (input) => guarded(() => args.api.files.tree.query(input)),
    searchFiles: (input) => guarded(() => args.api.files.search.query(input)),
    readFile: (input) => guarded(() => args.api.files.read.query(input)),
    createSession: (input) => guarded(() => args.api.sessions.create.mutate(input)),
    listProjects: async () => {
      const reply = await guarded(() => args.api.projects.list.query())
      return reply.map((project) => ({
        id: project.id,
        name: project.name,
        repo: project.repo,
        updatedAt: project.updatedAt,
      }))
    },
    createProject: async (input) => {
      const project = await guarded(() => args.api.projects.create.mutate(input))
      return {
        id: project.id,
        name: project.name,
        repo: project.repo,
        updatedAt: project.updatedAt,
      }
    },
    listModels: () => guarded(() => args.api.models.list.query()),
    runCommand: (input) => guarded(() => args.api.sessions.command.mutate(input)),
    commands: async () => {
      const reply = await guarded(() => args.api.sessions.commands.query({}))
      return reply.commands
    },
    skills: async () => {
      const reply = await guarded(() => args.api.skillCatalogue.list.query({}))
      return reply.skills
    },
  }
}
