import { describe, expect, it } from 'bun:test'

import { CallInterruptedError, toThreadId, type AgentFileSystemPort } from '@dltech/atlas-core'

import { ReadTool } from '../read'
import { files } from './support'

const interruptedFiles = (): AgentFileSystemPort =>
  Object.assign(Object.create(files), {
    stat: () => Promise.reject(new CallInterruptedError('stat was interrupted')),
  })

describe('tools that tolerate a missing file', () => {
  it('still surface an interrupted call instead of reporting the file as missing', async () => {
    const read = new ReadTool({ files: interruptedFiles() }).invoke({
      input: { path: '/workspace/a.txt' },
      signal: new AbortController().signal,
      idempotencyKey: 'interrupted-read',
      projectDirectory: '/workspace',
      threadId: toThreadId('thread-1'),
    })

    await expect(read).rejects.toBeInstanceOf(CallInterruptedError)
  })
})
