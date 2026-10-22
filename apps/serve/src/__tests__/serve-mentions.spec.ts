import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  listMentionFilesReplySchema,
  mentionFileExistsReplySchema,
  readMentionFileReplySchema,
  threadMentionFiles,
} from '@dltech/atlas-harness'

import { connect, type TestClient } from './client'
import { fakeServeApp } from './fakes'
import { releaseServeSpec, start, startWithDriveSpec, TOKEN, threadId } from './serve-spec-fixture'
import { isReadOnlyFrame } from '../socket-state-requests'
import type { RequestFrame } from '../request-reply'

afterEach(releaseServeSpec)

const child = toThreadId('thread-child')
const foreign = toThreadId('thread-foreign')

const sandbox = mkdtempSync(join(tmpdir(), 'atlas-serve-mentions-'))
mkdirSync(join(sandbox, 'src'), { recursive: true })
writeFileSync(join(sandbox, 'sandbox-only.txt'), 'bytes that only exist in the sandbox')
writeFileSync(join(sandbox, 'src', 'a.ts'), 'a')
const childRoot = mkdtempSync(join(tmpdir(), 'atlas-serve-mentions-child-'))
writeFileSync(join(childRoot, 'child-only.txt'), 'child bytes')

const request = (args: { op: EClientRequest; params: unknown; id: string }): RequestFrame => ({
  kind: EClientFrame.Request,
  ...args,
})

const ask = async (args: { client: TestClient; op: EClientRequest; params: unknown }) => {
  const id = `${args.op}-${Math.random()}`
  args.client.send(request({ op: args.op, params: args.params, id }))
  const frame = await args.client.waitFor((candidate) => candidate.kind === EServeFrame.Reply && candidate.replyTo === id)
  if (frame.kind !== EServeFrame.Reply) throw new Error('missing reply')
  return frame
}

const attach = async (port: number): Promise<TestClient> => {
  const client = await connect({ port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0, protocol: CHANNEL_PROTOCOL_VERSION })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return client
}

const startSandbox = async () => {
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const workspaces = new Map<ThreadId, string>([[child, childRoot]])
  const threads: typeof app.threads = {
    ...app.threads,
    spawned: async ({ threadId: parent }) =>
      parent === threadId ? [{ id: child, head: 0, createdAt: '', updatedAt: '', workspace: childRoot, repo: null }] : [],
    find: async ({ threadId: wanted }) => ({
      id: wanted, head: 0, createdAt: '', updatedAt: '', repo: null, workspace: workspaces.get(wanted) ?? null,
    }),
  }
  return startWithDriveSpec({
    compose: async () => ({
      ...app,
      threads,
      mentionFiles: (id) => threadMentionFiles({ threadId: id, log: app.log, threads, launchDirectory: sandbox }),
    }),
  })
}

describe('mentions over the session socket', () => {
  it('reads sandbox-only bytes, existence and one folder level from the owning filesystem', async () => {
    const handle = await startSandbox()
    const client = await attach(handle.port)
    try {
      const listed = await ask({ client, op: EClientRequest.ListMentionFiles, params: { threadId, directory: '.' } })
      expect(listMentionFilesReplySchema.parse(listed.data).entries).toEqual([
        { name: 'sandbox-only.txt', isDirectory: false },
        { name: 'src', isDirectory: true },
      ])

      const yes = await ask({ client, op: EClientRequest.MentionFileExists, params: { threadId, path: 'sandbox-only.txt' } })
      const no = await ask({ client, op: EClientRequest.MentionFileExists, params: { threadId, path: 'laptop-only.txt' } })
      expect(mentionFileExistsReplySchema.parse(yes.data).exists).toBe(true)
      expect(mentionFileExistsReplySchema.parse(no.data).exists).toBe(false)

      const text = await ask({ client, op: EClientRequest.ReadMentionFile, params: { threadId, path: 'sandbox-only.txt' } })
      expect(readMentionFileReplySchema.parse(text.data).file).toEqual({
        type: 'text', path: 'sandbox-only.txt', content: 'bytes that only exist in the sandbox', truncated: false,
      })

      const folder = await ask({ client, op: EClientRequest.ReadMentionFile, params: { threadId, path: '.' } })
      expect(readMentionFileReplySchema.parse(folder.data).file).toEqual({
        type: 'listing', path: '.', content: 'sandbox-only.txt\nsrc/',
      })
    } finally { client.close() }
  })

  it('resolves a served child against its own workspace', async () => {
    const handle = await startSandbox()
    const client = await attach(handle.port)
    try {
      const reply = await ask({ client, op: EClientRequest.ReadMentionFile, params: { threadId: child, path: 'child-only.txt' } })
      expect(readMentionFileReplySchema.parse(reply.data).file).toMatchObject({ type: 'text', content: 'child bytes' })
    } finally { client.close() }
  })

  it('refuses malformed params and threads outside the served family', async () => {
    const handle = await startSandbox()
    const client = await attach(handle.port)
    try {
      for (const params of [{}, { threadId }, { threadId, path: 1 }, { threadId, path: 'a', extra: true }]) {
        const reply = await ask({ client, op: EClientRequest.ReadMentionFile, params })
        expect(reply.ok).toBe(false)
      }
      const outsider = await ask({ client, op: EClientRequest.ListMentionFiles, params: { threadId: foreign, directory: '.' } })
      expect(outsider.ok).toBe(false)
      expect(JSON.stringify(outsider.data)).toContain('does not belong')
    } finally { client.close() }
  })

  it('refuses explicitly when the serve has no mention capability', async () => {
    const { handle } = await start({})
    const client = await attach(handle.port)
    try {
      const reply = await ask({ client, op: EClientRequest.ReadMentionFile, params: { threadId, path: 'a' } })
      expect(reply.ok).toBe(false)
      expect(JSON.stringify(reply.data)).toContain('cannot read mentioned files')
    } finally { client.close() }
  })

  it('admits the mention reads while the session is parking', () => {
    for (const op of [EClientRequest.ListMentionFiles, EClientRequest.MentionFileExists, EClientRequest.ReadMentionFile]) {
      expect(isReadOnlyFrame(request({ op, params: {}, id: 'read' }))).toBe(true)
    }
  })
})
