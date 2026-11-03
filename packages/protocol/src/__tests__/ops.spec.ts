import { describe, expect, it } from 'bun:test'

import { callOpSchema, execOpSchema, grepOpSchema, writeFileOpSchema } from '../index'
import { hostFrameSchema, runFrameSchema } from '../frames'

const roundTrips = <T>(schema: { parse: (value: unknown) => T }, value: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(value)))

describe('callOpSchema', () => {
  it('round-trips every op', () => {
    const ops = [
      { op: 'exec', argv: ['echo', 'hi'], cwd: '/work', env: { A: 'b' }, timeoutMs: 5000 },
      { op: 'stat', path: '/work/a' },
      { op: 'readFile', path: '/work/a' },
      { op: 'readBytes', path: '/work/a' },
      { op: 'readTextForEdit', path: '/work/a' },
      { op: 'writeFile', path: '/work/a', content: 'hello', mode: 0o644 },
      { op: 'remove', path: '/work/a' },
      { op: 'mkdir', path: '/work/a' },
      { op: 'rename', from: '/work/a', to: '/work/b' },
      { op: 'readDirectory', path: '/work' },
      { op: 'glob', pattern: '**/*.ts', cwd: '/work', dot: true },
      { op: 'grep', pattern: 'needle', path: '/work', caseInsensitive: true, maxResults: 10 },
    ] as const
    for (const op of ops) expect(roundTrips(callOpSchema, op)).toEqual(op)
  })

  it('rejects an unknown op, extra keys and malformed fields', () => {
    expect(callOpSchema.safeParse({ op: 'shell', cmd: 'ls' }).success).toBe(false)
    expect(callOpSchema.safeParse({ op: 'exec', argv: [], surprise: 1 }).success).toBe(false)
    expect(callOpSchema.safeParse({ op: 'writeFile', path: '/a' }).success).toBe(false)
    expect(execOpSchema.safeParse({ op: 'exec', argv: ['ls'], timeoutMs: 0 }).success).toBe(false)
    expect(
      writeFileOpSchema.safeParse({ op: 'writeFile', path: '/a', content: '', mode: 0o1000 })
        .success,
    ).toBe(false)
    expect(
      grepOpSchema.safeParse({ op: 'grep', pattern: 'x', path: '/a', maxResults: 0 }).success,
    ).toBe(false)
  })

  it('carries a typed op inside a run frame', () => {
    const run = {
      kind: 'run',
      key: 'run-1:call-1',
      epoch: 5,
      op: { op: 'exec', argv: ['ls', '-la'], cwd: '/work' },
    } as const
    expect(roundTrips(runFrameSchema, run)).toEqual(run)
    expect(roundTrips(hostFrameSchema, run)).toEqual(run)
    expect(
      runFrameSchema.safeParse({
        kind: 'run',
        key: 'k',
        epoch: 1,
        op: { tool: 'bash', input: {} },
      }).success,
    ).toBe(false)
  })
})
