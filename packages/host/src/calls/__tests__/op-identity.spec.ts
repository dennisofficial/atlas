import { describe, expect, it } from 'bun:test'

import type { CallOp } from '@dltech/atlas-protocol'

import { runInCallScope, scopedOpKey } from '../call-scope'

const start = (serviceId: string): CallOp => ({
  op: 'services.start',
  serviceId,
  command: 'bun run dev',
  cwd: '/w',
  env: { PORT: '3000' },
})

const keysOf = (ops: readonly CallOp[]): readonly string[] =>
  runInCallScope({ scopeKey: 'run-1:call-1', body: () => ops.map((op) => scopedOpKey(op)) })

describe('scopedOpKey', () => {
  it('gives one operation the same key whatever ran before it', () => {
    const first = keysOf([start('svc-db'), start('svc-api')])
    const replay = keysOf([start('svc-api')])
    expect(replay[0]).toBe(first[1])
  })

  it('separates two identical operations inside one scope', () => {
    const [first, second] = keysOf([start('svc-api'), start('svc-api')])
    expect(first).not.toBe(second)
  })

  it('does not depend on the order the fields are written in', () => {
    const one = keysOf([start('svc-api')])
    const other = keysOf([
      {
        env: { PORT: '3000' },
        cwd: '/w',
        command: 'bun run dev',
        serviceId: 'svc-api',
        op: 'services.start',
      },
    ])
    expect(other[0]).toBe(one[0])
  })

  it('keeps the key inside the daemon key alphabet and the scope', () => {
    const [key] = keysOf([start('svc-api')])
    expect(key).toMatch(/^run-1:call-1\.[0-9a-f]{12}\.0$/)
  })
})
