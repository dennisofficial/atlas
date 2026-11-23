import { describe, expect, it } from 'bun:test'

import { EDaemonErrorKind } from '../../frames'
import { createInMemoryDaemon, inMemoryDaemonToken } from '../../testing'
import { unreadableRunOf } from '../unreadable-run'

const SANDBOX = 'atlas-v2-unreadable-run'
const SECRET = 'unreadable-run-secret'

const unknownRun = JSON.stringify({
  kind: 'run',
  key: 'host-unknown-op',
  epoch: 1,
  op: { op: 'no.such.op' },
})

describe('unreadableRunOf', () => {
  it('returns the key and op name of a run frame another schema rejected', () => {
    expect(
      unreadableRunOf({ kind: 'run', key: 'c-1', epoch: 1, op: { op: 'previews.ensure' } }),
    ).toEqual({ key: 'c-1', opName: 'previews.ensure' })
  })

  it('names the op generically when the op carries no readable name', () => {
    expect(unreadableRunOf({ kind: 'run', key: 'c-1', epoch: 1, op: {} })).toEqual({
      key: 'c-1',
      opName: 'the op',
    })
    expect(unreadableRunOf({ kind: 'run', key: 'c-1', epoch: 1, op: 'exec' })).toEqual({
      key: 'c-1',
      opName: 'the op',
    })
    expect(unreadableRunOf({ kind: 'run', key: 'c-1', epoch: 1 })).toEqual({
      key: 'c-1',
      opName: 'the op',
    })
  })

  it('ignores frames that are not a keyed run', () => {
    expect(unreadableRunOf({ kind: 'cancel', key: 'c-1', epoch: 1 })).toBeUndefined()
    expect(
      unreadableRunOf({ kind: 'run', key: 'not a key', epoch: 1, op: { op: 'exec' } }),
    ).toBeUndefined()
    expect(unreadableRunOf({ kind: 'run', epoch: 1, op: { op: 'exec' } })).toBeUndefined()
    expect(unreadableRunOf('run')).toBeUndefined()
    expect(unreadableRunOf(null)).toBeUndefined()
  })
})

describe('daemon engine unreadable run', () => {
  it('fails a run frame it cannot read with a keyed invalid-frame error', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const session = daemon.connect()
    session.send({
      kind: 'hello',
      sessionId: 's-unreadable-run',
      epoch: 1,
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    })
    await session.until((frame) => frame.kind === 'hello-reply', { label: 'hello-reply' })

    session.sendRaw(unknownRun)
    const error = await session.until(
      (frame) => frame.kind === 'error' && frame.key === 'host-unknown-op',
      { label: 'keyed error frame' },
    )
    if (error.kind !== 'error') throw new Error('no error frame')
    expect(error.errorKind).toBe(EDaemonErrorKind.InvalidFrame)
    expect(error.message.startsWith('this daemon cannot run no.such.op: ')).toBe(true)

    session.sendRaw(JSON.stringify({ kind: 'cancel', key: 'host-keyless' }))
    const keyless = await session.until(
      (frame) => frame.kind === 'error' && frame.key === undefined,
      { label: 'keyless error frame' },
    )
    if (keyless.kind !== 'error') throw new Error('no error frame')
    expect(keyless.errorKind).toBe(EDaemonErrorKind.InvalidFrame)

    session.close()
    await daemon.stop()
  })
})
