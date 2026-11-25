import type { SaidUpload, RecordEvent } from '@dltech/atlas-core'
import { EStreamResetReason, STREAM_PROTOCOL_MIN_VERSION } from '@dltech/atlas-protocol'
import type { CommandEntry } from '@dltech/atlas-commands'
import type {
  FilesSearchInput,
  FilesTreeInput,
  FilesTreeOutput,
  MediaConfirmInput,
  MediaPresignInput,
  MediaToolPictureInput,
  MediaUrlInput,
  SessionChangesInput,
  SessionChangesOutput,
  SessionCommandInput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionRetryInput,
  SessionStatusOutput,
  SessionStopInput,
  SessionSubscribeInput,
  SessionSubscribeOutput,
  ServicesLogInput,
  ServicesLogOutput,
  SessionUnsubscribeInput,
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

import { eventSchema, eventTypes, views } from '../registered-plugins'
import type { AuthRefusal, SessionClient } from '../session-client'
import type { ProjectChoice } from '../../ui/project-prompt-model'
import type {
  AccountCreateInput,
  AccountRow,
  ActiveAccountInput,
  DraftPutBody,
  McpOauthBeginInput,
  McpOauthBeginResult,
  McpOauthServer,
  ProviderSignInBegin,
  ProviderSignInBeginInput,
  ProviderSignInCompleteInput,
  ProviderSignInPoll,
  ProviderSignInPollInput,
  SetActiveAccountInput,
  GithubPollResult,
  ModelsProvider,
  ModelsReply,
  OperatorAnswerBody,
  PresenceBody,
  ProjectSaveBody,
  SecretNameBody,
  SecretPutBody,
  SessionApi,
  SettingRemoveBody,
  SigningKeyStatus,
  SettingRow,
  SettingWriteBody,
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
  mediaUrl: MediaUrlInput[]
  toolPicture: MediaToolPictureInput[]
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
  subscribe: SessionSubscribeInput[]
  unsubscribe: SessionUnsubscribeInput[]
  changes: SessionChangesInput[]
  servicesLog: ServicesLogInput[]
  reportPresence: PresenceBody[]
  listSettings: number
  setSetting: SettingWriteBody[]
  removeSetting: SettingRemoveBody[]
  secretNames: number
  putSecret: SecretPutBody[]
  removeSecret: SecretNameBody[]
  signingKeyStatus: number
  registerSigningKey: { privateKey: string }[]
  revokeSigningKey: number
  githubState: number
  beginGithubConnect: number
  pollGithubConnect: { deviceCode: string }[]
  disconnectGithub: number
  accounts: number
  activeAccount: ActiveAccountInput[]
  createAccount: AccountCreateInput[]
  setActiveAccount: SetActiveAccountInput[]
  removeAccount: { accountId: string }[]
  beginProviderSignIn: ProviderSignInBeginInput[]
  completeProviderSignIn: ProviderSignInCompleteInput[]
  pollProviderSignIn: ProviderSignInPollInput[]
  mcpServers: number
  mcpOauthBegin: McpOauthBeginInput[]
}

export type FakeSessionClient = SessionClient & {
  calls: FakeCalls
  setProjects: (projects: readonly ProjectChoice[]) => void
  setModels: (models: ModelsReply) => void
  setCommands: (commands: readonly CommandEntry[]) => void
  setSkills: (skills: SkillCatalogueReply['skills']) => void
  setSettings: (rows: readonly SettingRow[]) => void
  setSecretNames: (names: readonly string[]) => void
  setSigningKeyRegistered: (registered: boolean) => void
  setAccounts: (rows: readonly AccountRow[]) => void
  setActiveAccountId: (args: { provider: string; accountId: string }) => void
  setProviderSignIn: (begin: ProviderSignInBegin) => void
  queueSignInPoll: (answers: readonly ProviderSignInPoll[]) => void
  setMcpServers: (servers: readonly McpOauthServer[]) => void
  setMcpOauthBegin: (answer: McpOauthBeginResult) => void
  pushServiceLog: (reply: ServicesLogOutput) => void
  refuseServiceLog: (status: number) => void
  refuseSettingWrites: (message: string | null) => void
  refuseSettingReads: (message: string | null) => void
  pushCreated: (created: SessionCreateOutput) => void
  pushRows: (rows: readonly StreamSessionRow[]) => void
  pushEvents: (args: { sessionId: string; events: readonly RecordEvent[]; live: boolean }) => void
  pushView: (args: { sessionId: string; view: SessionViewOutput }) => void
  pushStatus: (args: { sessionId: string; status: SessionStatusOutput }) => void
  pushShellOutput: (args: {
    sessionId: string
    shellId: string
    offset: number
    text: string
  }) => void
  pushChanges: (reply: SessionChangesOutput) => void
  refuseChanges: (status: number) => void
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

const REGISTERED_KEY = {
  state: 'registered',
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterial atlas@octo',
  createdAt: '2026-11-20T00:00:00.000Z',
} as SigningKeyStatus

const CONNECTED_GITHUB = {
  status: 'connected',
  login: 'octo',
  scopes: ['repo'],
} as GithubPollResult

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

export const accountRowOf = (args: {
  id: string
  provider: string
  kind?: string
  label?: string
}): AccountRow => ({
  id: args.id,
  provider: args.provider,
  kind: args.kind ?? 'oauth',
  origin: 'login',
  label: args.label ?? 'Me',
  status: 'active',
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
})

export const fakeSessionClient = (args: {
  onAuthLost: (status: AuthRefusal) => void
  accounts?: readonly AccountRow[] | undefined
}): FakeSessionClient => {
  const fake = createFakeTransport()
  const scheduler = createFakeScheduler()
  let lastRows: readonly StreamSessionRow[] | null = null
  let replays = 0
  const transport = {
    follow: fake.transport.follow,
    list: (handlers: Parameters<typeof fake.transport.list>[0]) => {
      const port = fake.transport.list(handlers)
      if (lastRows === null) return port
      replays += 1
      handlers.handleFrame({
        type: 'snapshot',
        id: `replay-${replays}`,
        rows: lastRows.map((row) => ({ ...row })),
      })
      return port
    },
  }
  const connection: StreamConnection = createStreamConnection({
    transport,
    scheduler: scheduler.scheduler,
    networkSignal: NO_NETWORK_SIGNAL,
    eventSchema: eventSchema,
    knownEventTypes: eventTypes,
    views: views,
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
    mediaUrl: [],
    toolPicture: [],
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
    subscribe: [],
    unsubscribe: [],
    changes: [],
    servicesLog: [],
    reportPresence: [],
    listSettings: 0,
    setSetting: [],
    removeSetting: [],
    secretNames: 0,
    putSecret: [],
    removeSecret: [],
    signingKeyStatus: 0,
    registerSigningKey: [],
    revokeSigningKey: 0,
    githubState: 0,
    beginGithubConnect: 0,
    pollGithubConnect: [],
    disconnectGithub: 0,
    accounts: 0,
    activeAccount: [],
    createAccount: [],
    setActiveAccount: [],
    removeAccount: [],
    beginProviderSignIn: [],
    completeProviderSignIn: [],
    pollProviderSignIn: [],
    mcpServers: 0,
    mcpOauthBegin: [],
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
  const changesReplies: SessionChangesOutput[] = []
  let changesRefusal: number | null = null
  const serviceLogs: ServicesLogOutput[] = []
  let serviceLogRefusal: number | null = null
  let projects: readonly ProjectChoice[] = []
  let models: ModelsReply = DEFAULT_MODELS
  let commandEntries: readonly CommandEntry[] = []
  let skillEntries: SkillCatalogueReply['skills'] = []
  let settingRows: readonly SettingRow[] = []
  let secretNames: readonly string[] = []
  let signingKeyRegistered = false
  const held = args.accounts ?? [
    accountRowOf({ id: 'account-default', provider: 'anthropic', label: 'My Anthropic' }),
  ]
  let accountRows: readonly AccountRow[] = held
  let activeIds: Readonly<Record<string, string>> = Object.fromEntries(
    held.map((row) => [row.provider, row.id]),
  )
  let signInBegin = {
    flow: 'paste-code',
    attemptId: 'attempt-1',
    authorizeUrl: 'https://auth.example.test/anthropic',
    expiresInMs: 600_000,
  } as ProviderSignInBegin
  let pollAnswers: readonly ProviderSignInPoll[] = [{ status: 'pending' } as ProviderSignInPoll]
  let mcpServers: readonly McpOauthServer[] = []
  let mcpBegin = {
    outcome: 'redirect',
    authorizationUrl: 'https://mcp.example.test/authorize',
  } as McpOauthBeginResult
  let settingWriteRefusal: Error | null = null
  let settingReadRefusal: Error | null = null
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
    mediaUrl: async (input) => {
      calls.mediaUrl.push(input)
      return { url: 'https://media.example.test/picture' }
    },
    toolPicture: async (input) => {
      calls.toolPicture.push(input)
      return { mediaType: 'image/png', data: '' }
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
      calls.saveDraft.push({ scope: input.scope, text: input.text })
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
    subscribe: async (input): Promise<SessionSubscribeOutput> => {
      calls.subscribe.push(input)
      return {
        subscription: {
          id: 'sub-1',
          threadId: input.sessionId,
          provider: input.provider,
          target: input.target,
          label: '',
          events: input.events ?? [],
          createdBy: 'operator',
          createdAt: '2026-11-20T00:00:00.000Z',
        },
        existed: false,
        updated: true,
      }
    },
    unsubscribe: async (input) => {
      calls.unsubscribe.push(input)
      return { ended: true }
    },
    browseContext: async (input) => ({ directory: input.directory, entries: [] }),
    readContext: async (input) => ({
      file: {
        type: 'refused',
        path: input.path,
        reason: `${input.path} is not in the context directory`,
      },
    }),
    changes: async (input) => {
      calls.changes.push(input)
      if (changesRefusal !== null) {
        throw Object.assign(new Error('changes unavailable'), { status: changesRefusal })
      }
      return changesReplies.shift() ?? { checkouts: [] }
    },
    logService: async (input) => {
      calls.servicesLog.push(input)
      if (serviceLogRefusal !== null) {
        throw Object.assign(new Error('the log is unavailable'), { status: serviceLogRefusal })
      }
      return serviceLogs.shift() ?? { text: '', truncated: false }
    },
    reportPresence: async (input) => {
      calls.reportPresence.push(input)
    },
    listSettings: async () => {
      calls.listSettings += 1
      if (settingReadRefusal !== null) throw settingReadRefusal
      return settingRows
    },
    setSetting: async (input) => {
      calls.setSetting.push(input)
      if (settingWriteRefusal !== null) throw settingWriteRefusal
      settingRows = [
        ...settingRows.filter((row) => row.key !== input.key),
        { key: input.key, value: input.value },
      ]
    },
    removeSetting: async (input) => {
      calls.removeSetting.push(input)
      settingRows = settingRows.filter((row) => row.key !== input.key)
    },
    secretNames: async () => {
      calls.secretNames += 1
      return secretNames
    },
    putSecret: async (input) => {
      calls.putSecret.push(input)
    },
    removeSecret: async (input) => {
      calls.removeSecret.push(input)
    },
    signingKeyStatus: async () => {
      calls.signingKeyStatus += 1
      return signingKeyRegistered ? REGISTERED_KEY : ({ state: 'absent' } as SigningKeyStatus)
    },
    registerSigningKey: async (input) => {
      calls.registerSigningKey.push(input)
      signingKeyRegistered = true
      return REGISTERED_KEY
    },
    revokeSigningKey: async () => {
      calls.revokeSigningKey += 1
      signingKeyRegistered = false
    },
    githubState: async () => {
      calls.githubState += 1
      return {
        connected: true,
        login: 'octo',
        scopes: ['repo'],
        missingScopes: [],
        connectedAt: '2026-11-20T00:00:00.000Z',
      }
    },
    beginGithubConnect: async () => {
      calls.beginGithubConnect += 1
      return {
        deviceCode: 'device-1',
        userCode: 'abcd-1234',
        verificationUrl: 'https://github.example.test/device',
        expiresInMs: 60_000,
        intervalMs: 1,
      }
    },
    pollGithubConnect: async (input) => {
      calls.pollGithubConnect.push(input)
      return CONNECTED_GITHUB
    },
    disconnectGithub: async () => {
      calls.disconnectGithub += 1
    },
    accounts: async () => {
      calls.accounts += 1
      return accountRows
    },
    activeAccount: async (input) => {
      calls.activeAccount.push(input)
      return { accountId: activeIds[input.provider] ?? null }
    },
    createAccount: async (input) => {
      calls.createAccount.push(input)
      const row = accountRowOf({
        id: `account-${calls.createAccount.length}`,
        provider: String(input.provider),
        kind: String(input.secret.kind),
      })
      accountRows = [...accountRows, row]
      return row
    },
    setActiveAccount: async (input) => {
      calls.setActiveAccount.push(input)
      activeIds = { ...activeIds, [String(input.provider)]: input.accountId }
    },
    removeAccount: async (input) => {
      calls.removeAccount.push(input)
      accountRows = accountRows.filter((row) => row.id !== input.accountId)
    },
    beginProviderSignIn: async (input) => {
      calls.beginProviderSignIn.push(input)
      return signInBegin
    },
    completeProviderSignIn: async (input) => {
      calls.completeProviderSignIn.push(input)
      return accountRowOf({ id: 'account-complete', provider: 'anthropic' })
    },
    pollProviderSignIn: async (input) => {
      calls.pollProviderSignIn.push(input)
      const next = pollAnswers[0]
      pollAnswers = pollAnswers.length <= 1 ? pollAnswers : pollAnswers.slice(1)
      return next ?? ({ status: 'pending' } as ProviderSignInPoll)
    },
    mcpServers: async () => {
      calls.mcpServers += 1
      return mcpServers
    },
    mcpOauthBegin: async (input) => {
      calls.mcpOauthBegin.push(input)
      return mcpBegin
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
    pushChanges: (reply) => {
      changesReplies.push(reply)
    },
    refuseChanges: (status) => {
      changesRefusal = status
    },
    pushServiceLog: (reply) => {
      serviceLogs.push(reply)
    },
    refuseServiceLog: (status) => {
      serviceLogRefusal = status
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
    setSettings: (next) => {
      settingRows = next
    },
    setSecretNames: (next) => {
      secretNames = next
    },
    setSigningKeyRegistered: (next) => {
      signingKeyRegistered = next
    },
    setAccounts: (next) => {
      accountRows = next
    },
    setActiveAccountId: (next) => {
      activeIds = { ...activeIds, [next.provider]: next.accountId }
    },
    setProviderSignIn: (next) => {
      signInBegin = next
    },
    queueSignInPoll: (answers) => {
      pollAnswers = answers
    },
    setMcpServers: (next) => {
      mcpServers = next
    },
    setMcpOauthBegin: (next) => {
      mcpBegin = next
    },
    refuseSettingWrites: (message) => {
      settingWriteRefusal = message === null ? null : new Error(message)
    },
    refuseSettingReads: (message) => {
      settingReadRefusal = message === null ? null : new Error(message)
    },
    pushCreated: (next) => {
      created.push(next)
    },
    pushRows: (rows) => {
      const snapshot = rows.map((row) => ({ ...row }))
      lastRows = snapshot
      for (const subscription of fake.lists) {
        if (subscription.closed) continue
        subscription.handlers.handleFrame({
          type: 'snapshot',
          id: nextId(),
          rows: snapshot,
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
