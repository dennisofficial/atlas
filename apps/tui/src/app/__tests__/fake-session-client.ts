import type { SaidUpload, V2Event } from '@dltech/atlas-core'
import { EStreamResetReason, STREAM_PROTOCOL_MIN_VERSION } from '@dltech/atlas-protocol'
import type { CommandEntry } from '@dltech/atlas-commands'
import type {
  FilesSearchInput,
  FilesTreeInput,
  FilesTreeOutput,
  MediaConfirmInput,
  MediaPresignInput,
  SessionCommandInput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionRetryInput,
  SessionStatusOutput,
  SessionStopInput,
  SessionViewOutput,
  SessionWakeInput,
  SessionWithdrawInput,
  StreamSessionRow,
  StreamStepKey,
} from '@dltech/atlas-protocol'
import {
  createStreamConnection,
  type OverlayBlock,
  type StreamConnection,
} from '@dltech/atlas-client/stream'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
} from '@dltech/atlas-client/stream-fixture'

import { v2EventSchema, v2EventTypes, v2Views } from '../registered-plugins'
import type { AuthRefusal, SessionClient } from '../session-client'
import type { ProjectChoice } from '../../ui/project-prompt-model'
import type {
  DraftPutBody,
  ModelsProvider,
  ModelsReply,
  OperatorAnswerBody,
  ProjectSaveBody,
  SessionApi,
  SkillCatalogueReply,
  UploadPresignBody,
  UploadPresignReply,
} from '../session-api'

export type FakeCalls = {
  post: SessionPostInput[]
  withdraw: SessionWithdrawInput[]
  stop: SessionStopInput[]
  retry: SessionRetryInput[]
  wakePod: SessionWakeInput[]
  answerOperator: OperatorAnswerBody[]
  presignMedia: MediaPresignInput[]
  confirmMedia: MediaConfirmInput[]
  presignUpload: UploadPresignBody[]
  discardUpload: string[]
  loadDraft: string[]
  saveDraft: DraftPutBody[]
  clearDraft: string[]
  treeFiles: FilesTreeInput[]
  searchFiles: FilesSearchInput[]
  createSession: SessionCreateInput[]
  runCommand: SessionCommandInput[]
  createProject: ProjectSaveBody[]
  listProjects: number
  listModels: number
  commands: number
  skills: number
}

export type FakeSessionClient = SessionClient & {
  calls: FakeCalls
  setProjects: (projects: readonly ProjectChoice[]) => void
  setModels: (models: ModelsReply) => void
  setCommands: (commands: readonly CommandEntry[]) => void
  setSkills: (skills: SkillCatalogueReply['skills']) => void
  pushCreated: (created: SessionCreateOutput) => void
  pushRows: (rows: readonly StreamSessionRow[]) => void
  pushEvents: (args: { sessionId: string; events: readonly V2Event[]; live: boolean }) => void
  pushView: (args: { sessionId: string; view: SessionViewOutput }) => void
  pushStatus: (args: { sessionId: string; status: SessionStatusOutput }) => void
  pushShellOutput: (args: {
    sessionId: string
    shellId: string
    offset: number
    text: string
  }) => void
  pushReset: (args: { sessionId: string; tailFrom?: number }) => void
  pushOverlay: (args: {
    sessionId: string
    key: StreamStepKey
    blocks: readonly OverlayBlock[]
  }) => void
  open: () => void
  dropConnection: () => void
  holdPost: (hold: boolean) => void
  releasePost: () => void
  queueTrees: (trees: readonly FilesTreeOutput[]) => void
  refuse: (status: AuthRefusal) => void
}

const NO_NETWORK_SIGNAL = () => () => undefined

const UPLOAD_URL = 'https://upload.example.test/1'

const uploadOf = (body: UploadPresignBody): SaidUpload => ({
  uploadId: `upload-${body.name}`,
  pathname: `composer-uploads/${body.name}`,
  name: body.name,
  size: body.size,
  mediaType: body.mediaType,
})

const CONNECTED = 'connected' as ModelsProvider['status']

const DEFAULT_MODELS: ModelsReply = {
  providers: [
    {
      id: 'anthropic',
      label: 'Anthropic',
      status: CONNECTED,
      live: false,
      models: [
        {
          id: 'anthropic/claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          contextWindow: 200_000,
          efforts: ['low', 'medium', 'high'],
          fast: true,
        },
        {
          id: 'anthropic/claude-opus-5-5',
          label: 'Claude Opus 5.5',
          contextWindow: 200_000,
          efforts: ['low', 'medium', 'high'],
        },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      status: CONNECTED,
      live: false,
      models: [
        {
          id: 'openai/gpt-5',
          label: 'GPT-5',
          contextWindow: 400_000,
          efforts: ['low', 'medium', 'high'],
        },
      ],
    },
  ],
}

export const fakeSessionClient = (args: {
  onAuthLost: (status: AuthRefusal) => void
}): FakeSessionClient => {
  const fake = createFakeTransport()
  const scheduler = createFakeScheduler()
  const connection: StreamConnection = createStreamConnection({
    transport: fake.transport,
    scheduler: scheduler.scheduler,
    networkSignal: NO_NETWORK_SIGNAL,
    eventSchema: v2EventSchema,
    knownEventTypes: v2EventTypes,
    views: v2Views,
  })

  const calls: FakeCalls = {
    post: [],
    withdraw: [],
    stop: [],
    retry: [],
    wakePod: [],
    answerOperator: [],
    presignMedia: [],
    confirmMedia: [],
    presignUpload: [],
    discardUpload: [],
    loadDraft: [],
    saveDraft: [],
    clearDraft: [],
    treeFiles: [],
    searchFiles: [],
    createSession: [],
    runCommand: [],
    createProject: [],
    listProjects: 0,
    listModels: 0,
    commands: 0,
    skills: 0,
  }

  let frames = 0
  const nextId = (): string => {
    frames += 1
    return `frame-${frames}`
  }

  let inboxes = 0
  const nextInbox = (): number => {
    inboxes += 1
    return inboxes
  }

  const trees: FilesTreeOutput[] = []
  let projects: readonly ProjectChoice[] = []
  let models: ModelsReply = DEFAULT_MODELS
  let commandEntries: readonly CommandEntry[] = []
  let skillEntries: SkillCatalogueReply['skills'] = []
  const created: SessionCreateOutput[] = []
  let projectCount = 0
  let postHeld = false
  let releaseHeld: (() => void) | null = null

  const post = async (input: SessionPostInput): Promise<{ inboxId: number }> => {
    calls.post.push(input)
    if (postHeld) {
      await new Promise<void>((resolve) => {
        releaseHeld = resolve
      })
    }
    return { inboxId: nextInbox() }
  }

  const api: SessionApi = {
    post,
    withdraw: async (input) => {
      calls.withdraw.push(input)
      return { ok: true }
    },
    stop: async (input) => {
      calls.stop.push(input)
      return { inboxId: nextInbox() }
    },
    retry: async (input) => {
      calls.retry.push(input)
      return { inboxId: nextInbox() }
    },
    wakePod: async (input) => {
      calls.wakePod.push(input)
      return { state: 'waking' }
    },
    answerOperator: async (input) => {
      calls.answerOperator.push(input)
    },
    presignMedia: async (input) => {
      calls.presignMedia.push(input)
      return { exists: false, uploadUrl: UPLOAD_URL, validUntil: 0 }
    },
    confirmMedia: async (input) => {
      calls.confirmMedia.push(input)
      return {
        media: { hash: input.hash, mediaType: 'image/png', size: 1, width: 1, height: 1 },
      }
    },
    presignUpload: async (input): Promise<UploadPresignReply> => {
      calls.presignUpload.push(input)
      return { upload: uploadOf(input), uploadUrl: UPLOAD_URL, validUntil: 0 }
    },
    discardUpload: async (pathname) => {
      calls.discardUpload.push(pathname)
    },
    loadDraft: async (scope) => {
      calls.loadDraft.push(scope)
      return null
    },
    saveDraft: async (input) => {
      calls.saveDraft.push({ scope: input.scope, text: input.text, uploads: [] })
    },
    clearDraft: async (scope) => {
      calls.clearDraft.push(scope)
    },
    treeFiles: async (input) => {
      calls.treeFiles.push(input)
      return trees.shift() ?? { directory: input.directory, entries: [] }
    },
    searchFiles: async (input) => {
      calls.searchFiles.push(input)
      return { paths: [], truncated: false }
    },
    readFile: async (input) => ({
      file: { type: 'text', path: input.path, content: '', truncated: false, bytes: 0 },
    }),
    createSession: async (input) => {
      calls.createSession.push(input)
      return created.shift() ?? { sessionId: 'session-created', mainThreadId: 'thread-created' }
    },
    listProjects: async () => {
      calls.listProjects += 1
      return projects
    },
    createProject: async (input) => {
      calls.createProject.push(input)
      projectCount += 1
      return {
        id: `project-${projectCount}`,
        name: input.name,
        repo: input.repo,
        updatedAt: '2026-11-20T00:00:00.000Z',
      }
    },
    listModels: async () => {
      calls.listModels += 1
      return models
    },
    runCommand: async (input) => {
      calls.runCommand.push(input)
      return { inboxId: nextInbox() }
    },
    commands: async () => {
      calls.commands += 1
      return commandEntries
    },
    skills: async () => {
      calls.skills += 1
      return skillEntries
    },
  }

  return {
    apiUrl: 'https://api.example.test',
    api,
    calls,
    connection,
    close: () => connection.close(),
    queueTrees: (next) => {
      trees.push(...next)
    },
    setProjects: (next) => {
      projects = next
    },
    setModels: (next) => {
      models = next
    },
    setCommands: (next) => {
      commandEntries = next
    },
    setSkills: (next) => {
      skillEntries = next
    },
    pushCreated: (next) => {
      created.push(next)
    },
    pushRows: (rows) => {
      for (const subscription of fake.lists) {
        if (subscription.closed) continue
        subscription.handlers.handleFrame({
          type: 'snapshot',
          id: nextId(),
          rows: rows.map((row) => ({ ...row })),
        })
      }
    },
    pushEvents: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame(
          eventsMessage({ id: input.sessionId, events: input.events, live: input.live }),
        )
      }
    },
    pushView: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame({
          type: 'view',
          id: nextId(),
          name: 'session',
          at: input.view.at,
          value: input.view,
        })
      }
    },
    pushStatus: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame({
          type: 'view',
          id: nextId(),
          name: 'status',
          at: 0,
          value: input.status,
        })
      }
    },
    pushShellOutput: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame({
          type: 'frame',
          id: nextId(),
          frame: {
            type: 'shell-output',
            shellId: input.shellId,
            offset: input.offset,
            text: input.text,
          },
        })
      }
    },
    pushReset: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame({
          type: 'reset',
          id: nextId(),
          reason: EStreamResetReason.Ahead,
          tailFrom: input.tailFrom ?? 0,
        })
      }
    },
    pushOverlay: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame({
          type: 'overlay',
          id: nextId(),
          key: input.key,
          afterSeq: 0,
          blocks: input.blocks.map((block) => ({ ...block })),
        })
      }
    },
    open: () => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        subscription.handlers.handleFrame({
          type: 'ready',
          v: STREAM_PROTOCOL_MIN_VERSION,
          connectionId: nextId(),
        })
      }
    },
    dropConnection: () => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        subscription.handlers.handleFailure(undefined)
      }
    },
    holdPost: (hold) => {
      postHeld = hold
    },
    releasePost: () => {
      const release = releaseHeld
      releaseHeld = null
      release?.()
    },
    refuse: (status) => {
      args.onAuthLost(status)
      for (const subscription of [...fake.lists, ...fake.follows]) {
        subscription.handlers.handleFailure(status)
      }
    },
  }
}
