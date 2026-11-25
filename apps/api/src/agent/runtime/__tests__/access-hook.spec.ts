import { toThreadId } from '@dltech/atlas-core'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'
import { describe, expect, it } from 'bun:test'

import type { AccessRows, AccessSource } from '../../config/access-rows'
import { accessHook } from '../access-hook'
import { ACCESS_KEY, ACCESS_SLOT, accessNoticeOf } from '../access-notice'

const THREAD_ID = toThreadId('thread-access')

const ROWS: AccessRows = {
  group: null,
  userGrants: [{ id: 'grant-1', name: 'Personal', instruction: '' }],
  groupGrants: [],
  projectGrants: [],
  userSecrets: [{ name: 'API_KEY', grantId: 'grant-1' }],
  groupSecrets: [],
  projectSecrets: [],
  userFiles: [],
  groupFiles: [],
  projectFiles: [],
}

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const sourceOf = (read: AccessSource['read']): AccessSource => ({ read })

const runOf = async (hook: ReturnType<typeof accessHook>) =>
  await hook.run({ threadId: THREAD_ID, projectDirectory: '/w' })

describe('accessHook', () => {
  it('returns one current access notice for the session scope it was given', async () => {
    const seen: { userId: string; projectId: string | null }[] = []
    const hook = accessHook({
      source: sourceOf(async (args) => {
        seen.push(args)
        return ROWS
      }),
      userId: 'user-1',
      projectId: 'project-1',
    })

    const outcome = await runOf(hook)

    expect(seen).toEqual([{ userId: 'user-1', projectId: 'project-1' }])
    expect(outcome).toEqual({
      drafts: [
        {
          type: 'context-loaded',
          slot: ACCESS_SLOT,
          key: ACCESS_KEY,
          content: accessNoticeOf(ROWS),
        },
      ],
    })
  })

  it('returns no draft and logs once when the read fails, so the previous notice stays current', async () => {
    const log = new RecordingLog()
    const hook = accessHook({
      source: sourceOf(async () => {
        throw new Error('database is unreachable')
      }),
      userId: 'user-1',
      projectId: null,
      log,
    })

    const outcome = await runOf(hook)

    expect(outcome).toEqual({})
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]).toMatchObject({
      source: 'runtime.access',
      error: 'database is unreachable',
    })
  })
})
