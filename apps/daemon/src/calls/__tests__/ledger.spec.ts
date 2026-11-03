import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CallOp } from '@dltech/atlas-protocol'

import { daemonHomeFromEnv } from '../../journal'
import { CallLedger, ELedgerError } from '../ledger'

const EPOCH = 3

const execOp: CallOp = { op: 'exec', argv: ['/bin/sh', '-c', 'echo hi'] }
const writeOp: CallOp = { op: 'writeFile', path: '/tmp/atlas-ledger-x', content: 'x' }

let home = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'atlas-ledger-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const pendingOps = {
  exec: { streams: false as const, run: async () => await new Promise(() => {}) },
  writeFile: { streams: false as const, run: async () => await new Promise(() => {}) },
}

const newLedger = (bootId = 'boot-1'): CallLedger =>
  new CallLedger({ home, ops: pendingOps, env: {} }, bootId)

describe('CallLedger', () => {
  it('journals running state to disk before reporting', async () => {
    const ledger = newLedger()
    await ledger.boot()
    ledger.hello({ epoch: EPOCH })
    const outcome = await ledger.run({ key: 'k1', epoch: EPOCH, op: writeOp })
    expect(outcome).toEqual({ ok: true, state: 'running' })
    const raw = JSON.parse(readFileSync(join(home, 'calls', 'k1', 'state.json'), 'utf8'))
    expect(raw.state).toBe('running')
    expect(raw.epoch).toBe(EPOCH)
    expect(raw.op).toEqual(writeOp)
  })

  it('refuses a stale epoch on run, ack and cancel', async () => {
    const ledger = newLedger()
    await ledger.boot()
    ledger.hello({ epoch: 5 })
    for (const attempt of [
      () => ledger.run({ key: 'k', epoch: 4, op: execOp }),
      () => ledger.ack({ key: 'k', epoch: 4 }),
      () => ledger.cancel({ key: 'k', epoch: 4 }),
    ]) {
      const outcome = await attempt()
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.failure.error).toBe(ELedgerError.StaleEpoch)
    }
  })

  it('prunes every unacked call at boot', async () => {
    const first = newLedger('boot-1')
    await first.boot()
    first.hello({ epoch: EPOCH })
    await first.run({ key: 'k1', epoch: EPOCH, op: writeOp })
    expect(existsSync(join(home, 'calls', 'k1', 'state.json'))).toBe(true)

    const second = newLedger('boot-2')
    await second.boot()
    expect(existsSync(join(home, 'calls'))).toBe(false)
    second.hello({ epoch: EPOCH })
    const outcome = await second.ack({ key: 'k1', epoch: EPOCH })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.error).toBe(ELedgerError.UnknownKey)
  })

  it('restores a done journal without spawning again', async () => {
    let runs = 0
    const ops = {
      writeFile: {
        streams: false as const,
        run: async () => {
          runs += 1
          return { wrote: '/tmp/atlas-ledger-x' }
        },
      },
    }
    const first = new CallLedger({ home, ops, env: {} }, 'boot-1')
    await first.boot()
    first.hello({ epoch: EPOCH })
    await first.run({ key: 'k1', epoch: EPOCH, op: writeOp })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runs).toBe(1)

    for (let attempt = 0; attempt < 50; attempt++) {
      const raw = readFileSync(join(home, 'calls', 'k1', 'state.json'), 'utf8')
      if ((JSON.parse(raw) as { state: string }).state === 'done') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const second = new CallLedger({ home, ops, env: {} }, 'boot-1')
    second.hello({ epoch: EPOCH })
    const outcome = await second.run({ key: 'k1', epoch: EPOCH, op: writeOp })
    expect(outcome).toEqual({ ok: true, state: 'done', result: { wrote: '/tmp/atlas-ledger-x' } })
    expect(runs).toBe(1)
    await second.ack({ key: 'k1', epoch: EPOCH })
    expect(existsSync(join(home, 'calls', 'k1'))).toBe(false)
  })

  it('treats a running journal with no result as never arrived', async () => {
    const ledger = newLedger()
    await ledger.boot()
    ledger.hello({ epoch: EPOCH })
    await ledger.run({ key: 'k1', epoch: EPOCH, op: execOp })
    expect(existsSync(join(home, 'calls', 'k1', 'state.json'))).toBe(true)

    const fresh = new CallLedger({ home, ops: pendingOps, env: {} }, 'boot-1')
    fresh.hello({ epoch: EPOCH })
    const outcome = await fresh.run({ key: 'k1', epoch: EPOCH, op: execOp })
    expect(outcome).toEqual({ ok: true, state: 'running' })
    await fresh.cancel({ key: 'k1', epoch: EPOCH })

    const pruned = new CallLedger({ home, ops: pendingOps, env: {} }, 'boot-1')
    await pruned.boot()
    pruned.hello({ epoch: EPOCH })
    const prunedOutcome = await pruned.run({ key: 'k1', epoch: EPOCH, op: execOp })
    expect(prunedOutcome).toEqual({ ok: true, state: 'running' })
  })

  it('reads the daemon home from ATLAS_DAEMON_HOME', () => {
    expect(daemonHomeFromEnv({ ATLAS_DAEMON_HOME: '/x', HOME: '/h' })).toBe('/x')
    expect(daemonHomeFromEnv({ HOME: '/h' })).toBe('/h/.atlas-daemon')
  })
})
