import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { logFieldsOf } from '@dltech/atlas-harness'

import { durableOpLog } from '../durable-op-log'

describe('durableOpLog', () => {
  it('writes the boot failure to the home-level logs.jsonl with its stack', async () => {
    const log = durableOpLog()
    expect(log).not.toBeNull()

    const error = new Error('the credentials store would not open')
    log?.error({
      source: 'tui.boot',
      message: 'atlas could not start',
      ...logFieldsOf({ error }),
      data: { cwd: '/work' },
    })
    await log?.settled()

    const file = join(process.env.ATLAS_HOME ?? '', 'logs.jsonl')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    const parsed = JSON.parse(lines[lines.length - 1] ?? '') as Record<string, unknown>

    expect(parsed.v).toBe(1)
    expect(parsed.severity).toBe('error')
    expect(parsed.source).toBe('tui.boot')
    expect(parsed.message).toBe('atlas could not start')
    expect(parsed.error).toBe('the credentials store would not open')
    expect(parsed.stack).toBe(error.stack)
    expect(parsed.data).toEqual({ cwd: '/work' })
    expect(parsed.threadId).toBeUndefined()
  })
})
