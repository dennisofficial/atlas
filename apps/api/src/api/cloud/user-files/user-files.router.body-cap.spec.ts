import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { UserFilesRouter } from './user-files.router'
import { UserFilesService } from './user-files.service'

const HARNESS_FILE_CAP_BYTES = 3_000_000
const FOUR_MIB = 4 * 1024 * 1024
const LONGEST_PATH = `${'d/'.repeat(249)}x`

const largestLegalPut = () => {
  const bytes = new Uint8Array(HARNESS_FILE_CAP_BYTES).fill(0x61)
  return {
    tree: 'instructions',
    path: LONGEST_PATH,
    content: Buffer.from(bytes).toString('base64'),
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    baseRevision: 0,
  }
}

describe('userFiles.put under the 4 MB JSON body cap', () => {
  let app: INestApplication
  const received: number[] = []
  const recordingFiles = {
    async put(args: { content: string }) {
      received.push(args.content.length)
      return { revision: 1 }
    },
  }

  beforeAll(async () => {
    app = await buildSessionTrpcApp({
      providers: [UserFilesRouter, { provide: UserFilesService, useValue: recordingFiles }],
    })
  })

  afterAll(() => app.close())

  it('carries the largest file the harness syncs, with the longest legal path, in one body', async () => {
    const input = largestLegalPut()
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(FOUR_MIB)

    const reply = await trpcMutation({ app, path: 'userFiles.put', token: 'session-a', input })

    expect(reply.status).toBe(200)
    expect(dataOf(reply.body)).toEqual({ revision: 1 })
    expect(received).toEqual([input.content.length])
  })

  it('refuses a body over the cap with 413', async () => {
    const reply = await trpcMutation({
      app,
      path: 'userFiles.put',
      token: 'session-a',
      input: { ...largestLegalPut(), content: 'A'.repeat(FOUR_MIB + 1024) },
    })

    expect(reply.status).toBe(413)
  })

  it('keeps userFiles.get on the same global cap', async () => {
    const reply = await trpcMutation({
      app,
      path: 'userFiles.get',
      token: 'session-a',
      input: { tree: 'skills', paths: ['x'.repeat(FOUR_MIB + 1024)] },
    })

    expect(reply.status).toBe(413)
  })
})
