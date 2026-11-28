import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PreviewTunnelRedial } from '@dltech/atlas-protocol'

import { TunnelSupervisor } from '../tunnel-supervisor'

const HEARTBEAT_MS = 10

const waitForRedial = async (supervisor: TunnelSupervisor): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = supervisor.status()
    if (status.state === 'up' && status.restarts > 0) return
    await Bun.sleep(20)
  }
  throw new Error('cloudflared never redialed')
}

describe('tunnel freeze detection', () => {
  let dir: string
  let supervisor: TunnelSupervisor
  let wallMs: number
  let monotonicMs: number
  const logs: string[] = []
  const redials: PreviewTunnelRedial[] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-tunnel-clocks-'))
    const binary = join(dir, 'cloudflared')
    writeFileSync(
      binary,
      [
        '#!/bin/sh',
        'printf "%s\\n" "$$" >> "$START_PATH"',
        'while [ -f "$HOLD_PATH" ]; do sleep 0.01; done',
        'printf "%s\\n" "Registered tunnel connection"',
        'exec sleep 60',
      ].join('\n'),
    )
    chmodSync(binary, 0o755)
    wallMs = 100_000
    monotonicMs = 10_000
    logs.length = 0
    redials.length = 0
    const args = {
      binary,
      env: {
        PATH: process.env.PATH,
        START_PATH: join(dir, 'starts'),
        HOLD_PATH: join(dir, 'hold'),
      },
      file: join(dir, 'token.json'),
      readyTimeoutMs: 2_000,
      heartbeatMs: HEARTBEAT_MS,
      wallNow: () => wallMs,
      monotonicNow: () => monotonicMs,
      onRedial: (result: PreviewTunnelRedial) => redials.push(result),
      log: (line: string) => logs.push(line),
    }
    supervisor = new TunnelSupervisor(args)
  })

  afterEach(async () => {
    await supervisor.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  const advanceClocks = (args: { wallDeltaMs: number; monotonicDeltaMs: number }): void => {
    wallMs += args.wallDeltaMs
    monotonicMs += args.monotonicDeltaMs
  }

  it('redials once after a freeze shorter than the wall-gap fallback', async () => {
    const first = await supervisor.start('token')
    advanceClocks({ wallDeltaMs: 16_000, monotonicDeltaMs: 1_000 })
    await waitForRedial(supervisor)
    expect(supervisor.status().pid).not.toBe(first.pid)
    advanceClocks({ wallDeltaMs: 1_000, monotonicDeltaMs: 1_000 })
    await Bun.sleep(HEARTBEAT_MS * 4)
    expect(supervisor.status().restarts).toBe(1)
    expect(readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(logs).toHaveLength(1)
    expect(redials).toHaveLength(1)
    expect(redials[0]).toMatchObject({
      reason: 'freeze',
      gapMs: 16_000,
      skewMs: 15_000,
      stopMs: 0,
      registerMs: 0,
      ok: true,
    })
    expect(supervisor.status().lastRedial).toEqual(redials[0])
  })

  it('coalesces another freeze heartbeat while a redial is in flight', async () => {
    await supervisor.start('token')
    writeFileSync(join(dir, 'hold'), '')
    advanceClocks({ wallDeltaMs: 16_000, monotonicDeltaMs: 1_000 })
    for (let attempt = 0; attempt < 100 && supervisor.status().restarts === 0; attempt += 1) {
      await Bun.sleep(20)
    }
    expect(supervisor.status().state).toBe('starting')
    advanceClocks({ wallDeltaMs: 16_000, monotonicDeltaMs: 1_000 })
    await Bun.sleep(HEARTBEAT_MS * 4)
    expect(supervisor.status().restarts).toBe(1)
    unlinkSync(join(dir, 'hold'))
    await waitForRedial(supervisor)
    await Bun.sleep(HEARTBEAT_MS * 4)
    expect(supervisor.status().restarts).toBe(1)
    expect(readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(logs).toHaveLength(1)
  })

  it('measures registration with the monotonic clock instead of the wall clock', async () => {
    await supervisor.start('token')
    writeFileSync(join(dir, 'hold'), '')
    advanceClocks({ wallDeltaMs: 16_000, monotonicDeltaMs: 1_000 })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n').length === 2) break
      await Bun.sleep(20)
    }
    advanceClocks({ wallDeltaMs: 9_000, monotonicDeltaMs: 321 })
    unlinkSync(join(dir, 'hold'))
    await waitForRedial(supervisor)
    expect(redials).toHaveLength(1)
    expect(redials[0]?.registerMs).toBe(321)
  })

  it('reports a failed registration once and retains it for a later host', async () => {
    await supervisor.start('token')
    writeFileSync(join(dir, 'cloudflared'), '#!/bin/sh\nexit 7\n')
    advanceClocks({ wallDeltaMs: 16_000, monotonicDeltaMs: 1_000 })
    for (let attempt = 0; attempt < 100 && redials.length === 0; attempt += 1) {
      await Bun.sleep(20)
    }
    expect(redials).toHaveLength(1)
    expect(redials[0]).toMatchObject({ reason: 'freeze', ok: false })
    expect(supervisor.status().lastRedial).toEqual(redials[0])
  })

  it('leaves a six-second event-loop stall alone when both clocks advance equally', async () => {
    const first = await supervisor.start('token')
    advanceClocks({ wallDeltaMs: 6_000, monotonicDeltaMs: 6_000 })
    await Bun.sleep(HEARTBEAT_MS * 4)
    expect(supervisor.status().pid).toBe(first.pid)
    expect(supervisor.status().restarts).toBe(0)
    expect(logs).toHaveLength(0)
  })

  it('retains the long wall-gap fallback when both clocks advance', async () => {
    await supervisor.start('token')
    advanceClocks({ wallDeltaMs: 35_000, monotonicDeltaMs: 35_000 })
    await waitForRedial(supervisor)
    expect(supervisor.status().restarts).toBe(1)
    expect(redials[0]).toMatchObject({ reason: 'gap', gapMs: 35_000, skewMs: 0, ok: true })
  })

  it('leaves ordinary heartbeat jitter below the skew threshold alone', async () => {
    const first = await supervisor.start('token')
    advanceClocks({ wallDeltaMs: 2_999, monotonicDeltaMs: 1_000 })
    await Bun.sleep(HEARTBEAT_MS * 4)
    expect(supervisor.status().pid).toBe(first.pid)
    expect(supervisor.status().restarts).toBe(0)
  })

  it('redials at the skew threshold even for a short freeze', async () => {
    await supervisor.start('token')
    advanceClocks({ wallDeltaMs: 3_000, monotonicDeltaMs: 1_000 })
    await waitForRedial(supervisor)
    expect(supervisor.status().restarts).toBe(1)
  })
})
