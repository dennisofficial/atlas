import { beforeAll, describe, expect, it } from 'bun:test'

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { bashDescription } from '../bash-prose'
import { ForegroundOnlyShells } from '../../runtime/foreground-shells'
import { files, processes, useTempAtlasHome } from './support'

useTempAtlasHome()

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-bash-no-exposure-'))
})

const invoke = (input: Record<string, unknown>): Promise<ToolOutcome> =>
  new BashTool(new ForegroundOnlyShells(), files, processes).invoke({
    input: { description: 'Exercise the shell', ...input },
    signal: new AbortController().signal,
    idempotencyKey: `bash-no-exposure-${crypto.randomUUID()}`,
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

describe('bash no longer publishes ports', () => {
  it('rejects exposePort in the foreground and the background', async () => {
    for (const runInBackground of [false, true]) {
      const outcome = await invoke({ command: 'echo hi', exposePort: 3000, runInBackground })
      expect(outcome.ok).toBe(false)
    }
  }, 30_000)

  it('sends servers to services and keeps background for finite jobs', () => {
    const text = bashDescription({ defaultTimeoutMs: 1, maximumTimeoutMs: 2 })

    expect(text).toContain('finite jobs')
    expect(text).toContain('service_start')
    expect(text).not.toContain('exposePort')
  })
})
