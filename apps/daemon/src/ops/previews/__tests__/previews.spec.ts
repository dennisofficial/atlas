import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CallFailureError, type CallOp, type PreviewTunnelStatus } from '@dltech/atlas-protocol'
import type { CallContext, DaemonGroup, RegisteredOp } from '@dltech/atlas-protocol/engine'

import { previewsGroup } from '..'

const PRELUDE = [
  '#!/bin/sh',
  'printf "%s\\n" "$$" >> "$START_PATH"',
  'printf "%s" "$TUNNEL_TOKEN" > "$TOKEN_PATH"',
  'printf "%s\\n" "$@" > "$ARGV_PATH"',
]

const READY_SCRIPT = [
  ...PRELUDE,
  'printf "%s\\n" "INF Registered tunnel connection connIndex=0 event=0 protocol=quic"',
  'exec sleep 60',
].join('\n')

const GROUP_SCRIPT = [
  ...PRELUDE,
  'sleep 300 &',
  'printf "%s\\n" "$!" >> "$START_PATH"',
  'printf "%s\\n" "INF Registered tunnel connection connIndex=0"',
  'exec sleep 60',
].join('\n')

const CRASHING_SCRIPT = [
  '#!/bin/sh',
  'printf "%s\\n" "$(date +%s%N)" >> "$START_PATH"',
  'printf "%s\\n" "INF Registered tunnel connection connIndex=0"',
  'sleep 0.2',
  'exit 7',
].join('\n')

const EXITING_SCRIPT = [
  '#!/bin/sh',
  'printf "%s\\n" "mise ERROR No version is set for shim: cloudflared" >&2',
  'exit 3',
].join('\n')

const SILENT_SCRIPT = ['#!/bin/sh', 'echo $$ > "$PID_PATH"', 'exec sleep 60'].join('\n')

const NOISY_SCRIPT = [
  '#!/bin/sh',
  'i=0',
  'while [ "$i" -lt 200 ]; do',
  '  printf "%s\\n" "noise noise noise noise noise noise" >&2',
  '  i=$((i + 1))',
  'done',
  'printf "%s\\n" "mise ERROR No version is set for shim: cloudflared" >&2',
  'exit 1',
].join('\n')

const CTX: CallContext = {
  key: 'k',
  signal: new AbortController().signal,
  output: () => undefined,
  publish: () => undefined,
}

const runOp = async (group: DaemonGroup, op: CallOp): Promise<unknown> => {
  const registered: RegisteredOp | undefined = group.ops.find((one) => one.op === op.op)
  if (registered === undefined) throw new Error(`no op ${op.op}`)
  return await registered.run({ op, ctx: CTX })
}

const waitForFile = async (path: string): Promise<string> => {
  for (let turn = 0; turn < 100; turn += 1) {
    if (existsSync(path)) return readFileSync(path, 'utf8')
    await Bun.sleep(20)
  }
  throw new Error(`${path} was never written`)
}

const linesUntil = async (args: { path: string; count: number; ms: number }): Promise<number[]> => {
  let lines: number[] = []
  for (let waited = 0; waited < args.ms; waited += 50) {
    if (existsSync(args.path)) {
      lines = readFileSync(args.path, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => Number.parseInt(line, 10))
      if (lines.length >= args.count) return lines
    }
    await Bun.sleep(50)
  }
  return lines
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const diedWithin = async (args: { pid: number; ms: number }): Promise<boolean> => {
  for (let waited = 0; waited < args.ms; waited += 50) {
    if (!alive(args.pid)) return true
    await Bun.sleep(50)
  }
  return !alive(args.pid)
}

const failureOf = async (work: Promise<unknown>): Promise<CallFailureError> => {
  const caught = await work.catch((error: unknown) => error)
  if (!(caught instanceof CallFailureError)) {
    throw new Error(`expected a CallFailureError, got ${String(caught)}`)
  }
  return caught
}

describe('the pod tunnel', () => {
  let dir: string
  let startPath: string
  let tokenPath: string
  let tokenFile: string
  let argvPath: string
  let pidPath: string
  let group: DaemonGroup

  const binaryOf = (args: { dir: string; script: string }): string => {
    mkdirSync(args.dir, { recursive: true })
    const path = join(args.dir, 'cloudflared')
    writeFileSync(path, args.script)
    chmodSync(path, 0o755)
    return path
  }

  const groupOf = (
    options: {
      cloudflaredPath?: string | undefined
      previewReadyTimeoutMs?: number | undefined
      previewHeartbeatMs?: number | undefined
      previewSuspendGapMs?: number | undefined
    } = {},
  ): DaemonGroup =>
    previewsGroup({
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        START_PATH: startPath,
        TOKEN_PATH: tokenPath,
        PID_PATH: pidPath,
        ARGV_PATH: argvPath,
      },
      home: dir,
      cloudflaredPath: options.cloudflaredPath ?? join(dir, 'bin', 'cloudflared'),
      ...(options.previewReadyTimeoutMs === undefined
        ? {}
        : { previewReadyTimeoutMs: options.previewReadyTimeoutMs }),
      ...(options.previewHeartbeatMs === undefined
        ? {}
        : { previewHeartbeatMs: options.previewHeartbeatMs }),
      ...(options.previewSuspendGapMs === undefined
        ? {}
        : { previewSuspendGapMs: options.previewSuspendGapMs }),
    })({ publish: () => undefined })

  const ensure = async (tunnelToken?: string): Promise<PreviewTunnelStatus> =>
    (await runOp(
      group,
      tunnelToken === undefined
        ? { op: 'previews.ensure' }
        : { op: 'previews.ensure', tunnelToken },
    )) as PreviewTunnelStatus

  const status = async (): Promise<PreviewTunnelStatus> =>
    (await runOp(group, { op: 'previews.status' })) as PreviewTunnelStatus

  const statusUntil = async (args: {
    state: PreviewTunnelStatus['state']
    ms: number
  }): Promise<PreviewTunnelStatus> => {
    for (let waited = 0; waited < args.ms; waited += 50) {
      const now = await status()
      if (now.state === args.state) return now
      await Bun.sleep(50)
    }
    throw new Error(`the tunnel never reached ${args.state}`)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-previews-'))
    startPath = join(dir, 'starts.txt')
    tokenPath = join(dir, 'token.txt')
    argvPath = join(dir, 'argv.txt')
    pidPath = join(dir, 'pid.txt')
    tokenFile = join(dir, 'previews.json')
    binaryOf({ dir: join(dir, 'bin'), script: READY_SCRIPT })
    group = groupOf()
  })

  afterEach(async () => {
    await group.stop?.()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs one cloudflared for the pod with the token only in its environment', async () => {
    const first = await ensure('secret-token')
    const second = await ensure('secret-token')
    expect(first.state).toBe('up')
    expect(second).toEqual(first)
    expect(first.pid).toBeGreaterThan(0)
    expect(JSON.stringify(first)).not.toContain('secret-token')
    const argv = await waitForFile(argvPath)
    expect(argv.split('\n').filter((line) => line !== '')).toEqual([
      'tunnel',
      '--no-autoupdate',
      'run',
    ])
    expect(await waitForFile(tokenPath)).toBe('secret-token')
    await linesUntil({ path: startPath, count: 1, ms: 2_000 })
    await Bun.sleep(100)
    expect(
      readFileSync(startPath, 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
    ).toHaveLength(1)
  })

  it('writes the tunnel token to the pod once, readable by its owner only', async () => {
    const first = await ensure('secret-token')
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600)
    const stored = JSON.parse(readFileSync(tokenFile, 'utf8')) as Record<string, unknown>
    expect(stored.tunnelToken).toBe('secret-token')
    expect(stored.updatedAt).toBeString()
    await ensure('secret-token')
    expect(JSON.parse(readFileSync(tokenFile, 'utf8'))).toEqual(stored)
    expect((await status()).pid).toBe(first.pid as number)
  })

  it('brings the tunnel back from the token file with no host and no ensure', async () => {
    await ensure('secret-token')
    await group.stop?.()
    group = groupOf()
    const up = await statusUntil({ state: 'up', ms: 5_000 })
    expect(up.restarts).toBe(0)
    expect(up.pid).toBeGreaterThan(0)
    expect((await waitForFile(tokenPath)).slice(0, 'secret-token'.length)).toBe('secret-token')
  })

  it('restarts cloudflared after a crash, with a growing delay, and counts restarts', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'crash'), script: CRASHING_SCRIPT }),
    })
    await ensure('secret-token')
    let restarts = 0
    for (let turn = 0; turn < 200 && restarts < 2; turn += 1) {
      restarts = (await status()).restarts
      if (restarts < 2) await Bun.sleep(50)
    }
    expect(restarts).toBeGreaterThanOrEqual(2)
    const starts = await linesUntil({ path: startPath, count: 3, ms: 10_000 })
    expect(starts.length).toBeGreaterThanOrEqual(3)
    const first = (starts[1] ?? 0) - (starts[0] ?? 0)
    const second = (starts[2] ?? 0) - (starts[1] ?? 0)
    expect(first).toBeGreaterThan(900_000_000)
    expect(second).toBeGreaterThan(first + 500_000_000)
  })

  it('fails with the documented message when no token was ever published', async () => {
    const error = await failureOf(ensure())
    expect(error.message).toBe('no tunnel token has been published to this pod yet')
    expect(existsSync(tokenFile)).toBe(false)
    expect((await status()).state).toBe('stopped')
  })

  it('fails with the exit code and the output when cloudflared dies first', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'broken'), script: EXITING_SCRIPT }),
    })
    const error = await failureOf(ensure('x'))
    expect(error.message).toContain('code 3')
    expect(error.message).toContain('No version is set for shim: cloudflared')
    const now = await status()
    expect(now.state).toBe('failed')
    expect(now.lastError).toContain('code 3')
    expect(now.restarts).toBe(0)
  })

  it('reports only a bounded tail of a noisy failure', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'noisy'), script: NOISY_SCRIPT }),
    })
    const error = await failureOf(ensure('x'))
    expect(error.message).toContain('No version is set for shim')
    expect(error.message.length).toBeLessThan(3_000)
    expect((await status()).tail.length).toBeLessThan(2_500)
  })

  it('fails and kills cloudflared when the tunnel never registers', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'silent'), script: SILENT_SCRIPT }),
      previewReadyTimeoutMs: 200,
    })
    const error = await failureOf(ensure('x'))
    expect(error.message).toContain('did not register a tunnel connection')
    expect((await status()).state).toBe('failed')
    const pid = Number.parseInt(await waitForFile(pidPath), 10)
    expect(await diedWithin({ pid, ms: 5_000 })).toBe(true)
  })

  it('stops the process group of the tunnel', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'group'), script: GROUP_SCRIPT }),
    })
    const info = await ensure('secret-token')
    expect(info.state).toBe('up')
    const pids = await linesUntil({ path: startPath, count: 2, ms: 5_000 })
    expect(pids).toHaveLength(2)
    await group.stop?.()
    expect((await status()).state).toBe('stopped')
    for (const pid of pids) expect(await diedWithin({ pid, ms: 5_000 })).toBe(true)
  })

  it('cancels a pending restart when the daemon stops', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'crash'), script: CRASHING_SCRIPT }),
    })
    await ensure('secret-token')
    await statusUntil({ state: 'failed', ms: 5_000 })
    await group.stop?.()
    const starts = await linesUntil({ path: startPath, count: 1, ms: 5_000 })
    await Bun.sleep(1_400)
    expect(
      readFileSync(startPath, 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
    ).toHaveLength(starts.length)
  })

  it('reports the time the tunnel registered in its status', async () => {
    const up = await ensure('secret-token')
    expect(up.state).toBe('up')
    expect(up.upAt).toBeString()
    expect((await status()).upAt).toBe(up.upAt as string)
  })

  it('re-dials cloudflared after the pod did not run, with no host call', async () => {
    group = groupOf({ previewHeartbeatMs: 20, previewSuspendGapMs: 120 })
    const first = await ensure('secret-token')
    expect(first.upAt).toBeString()
    const blockedUntil = Date.now() + 300
    while (Date.now() < blockedUntil) {}
    const starts = await linesUntil({ path: startPath, count: 2, ms: 5_000 })
    expect(starts.length).toBeGreaterThanOrEqual(2)
    const up = await statusUntil({ state: 'up', ms: 5_000 })
    expect(up.restarts).toBeGreaterThanOrEqual(1)
    expect(up.pid).not.toBe(first.pid as number)
    expect(up.upAt).not.toBe(first.upAt as string)
  })

  it('leaves a tunnel that keeps ticking alone', async () => {
    group = groupOf({ previewHeartbeatMs: 20, previewSuspendGapMs: 1_000 })
    const first = await ensure('secret-token')
    await Bun.sleep(400)
    const starts = await linesUntil({ path: startPath, count: 1, ms: 1_000 })
    expect(starts).toHaveLength(1)
    const now = await status()
    expect(now.pid).toBe(first.pid as number)
    expect(now.restarts).toBe(0)
  })

  it('never resolves cloudflared through PATH', async () => {
    const shimMarker = join(dir, 'shim-ran.txt')
    const shimDir = join(dir, 'shims')
    binaryOf({
      dir: shimDir,
      script: ['#!/bin/sh', `printf ran > "${shimMarker}"`, 'exit 0'].join('\n'),
    })
    group = groupOf()
    await ensure('secret-token')
    expect(existsSync(shimMarker)).toBe(false)
    expect(await waitForFile(argvPath)).toContain('--no-autoupdate')
  })
})
