import { expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createThreadsHandler } from '../thread-routes'
import type { IThreadReads } from '../thread-reads'
import { localSummaryFixture } from './local-summary-fixture'

const reads: IThreadReads = {
  threads: async () => {
    throw new Error('root-list-failed')
  },
  rename: async () => true,
  events: async () => undefined,
  readCursor: async () => undefined,
  markRead: async () => undefined,
}

test('a genuine collection failure is a 502 rather than empty discovery', async () => {
  const handler = createThreadsHandler({ reads })
  const response = await handler(
    new Request('http://localhost/desktop/threads'),
    '/desktop/threads',
  )
  expect(response?.status).toBe(502)
  expect(await response?.json()).toMatchObject({
    code: 'thread-failed',
    message: 'root-list-failed',
  })
})

test('the real host keeps missing discovery empty but returns 502 for a non-directory sessions root', async () => {
  const fixture = await localSummaryFixture()
  try {
    const missing = await fixture.call({ path: '/desktop/threads' })
    expect(missing.status).toBe(200)
    expect(await missing.json()).toEqual({ threads: [] })
    await writeFile(join(fixture.home, 'sessions'), 'not a directory')
    const failed = await fixture.call({ path: '/desktop/threads' })
    expect(failed.status).toBe(502)
    expect(await failed.json()).toMatchObject({ code: 'thread-failed' })
    expect(fixture.mutations()).toBe(0)
    expect(fixture.socket.requests).toEqual([])
  } finally {
    await fixture.close()
  }
})
