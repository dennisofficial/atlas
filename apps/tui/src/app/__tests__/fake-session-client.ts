import type { SaidUpload, V2Event } from '@dltech/atlas-core'
import type {
  FilesSearchInput,
  FilesTreeInput,
  FilesTreeOutput,
  MediaConfirmInput,
  MediaPresignInput,
  SessionPostInput,
  SessionRetryInput,
  SessionStopInput,
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
import type {
  DraftPutBody,
  OperatorAnswerBody,
  SessionApi,
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
}

export type FakeSessionClient = SessionClient & {
  calls: FakeCalls
  pushRows: (rows: readonly StreamSessionRow[]) => void
  pushEvents: (args: { sessionId: string; events: readonly V2Event[]; live: boolean }) => void
  pushOverlay: (args: {
    sessionId: string
    key: StreamStepKey
    blocks: readonly OverlayBlock[]
  }) => void
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
