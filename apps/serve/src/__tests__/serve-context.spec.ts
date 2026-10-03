import { describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  atlasDirectory, contextDirectory, sessionDirectory, CHANNEL_PROTOCOL_VERSION,
  EClientFrame, EClientRequest, EServeFrame, listContextFilesReplySchema, readContextFileReplySchema,
} from '@dltech/atlas-harness'

import { connect } from './client'
import { start, TOKEN, threadId } from './serve-spec-fixture'
import { isReadOnlyFrame } from '../socket-state-requests'
import type { RequestFrame } from '../request-reply'

const request = (args: { op: EClientRequest; params: unknown; id: string }): RequestFrame => ({ kind: EClientFrame.Request, ...args })

describe('context files over the session socket', () => {
  it('lists and reads a sandbox-owned file and pushes filesystem changes', async () => {
    const root = contextDirectory({ sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: threadId }) })
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'plan.md'), '# First plan')
    const { handle } = await start({})
    const client = await connect({ port: handle.port, token: TOKEN })
    try {
      client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0, protocol: CHANNEL_PROTOCOL_VERSION })
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
      client.send(request({ op: EClientRequest.ListContextFiles, params: {}, id: 'list' }))
      const listed = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'list')
      if (listed.kind !== EServeFrame.Reply) throw new Error('missing reply')
      expect(listed.ok).toBe(true)
      expect(listContextFilesReplySchema.parse(listed.data).entries).toEqual([{ name: 'plan.md', isDirectory: false }])
      client.send(request({ op: EClientRequest.ReadContextFile, params: { path: 'plan.md' }, id: 'read' }))
      const read = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'read')
      if (read.kind !== EServeFrame.Reply) throw new Error('missing reply')
      expect(readContextFileReplySchema.parse(read.data).file).toEqual({ type: 'text', content: '# First plan', truncated: false })
      await writeFile(join(root, 'plan.md'), '# Updated plan')
      const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.Signal && frame.signal.type === 'context-changed')
      expect(pushed.kind).toBe(EServeFrame.Signal)
    } finally { client.close() }
  })

  it('admits both context reads while the session is parking', () => {
    for (const op of [EClientRequest.ListContextFiles, EClientRequest.ReadContextFile]) {
      expect(isReadOnlyFrame(request({ op, params: {}, id: 'read' }))).toBe(true)
    }
  })
})
