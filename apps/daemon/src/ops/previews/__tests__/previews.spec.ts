import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CallFailureError,
  type CallOp,
  type PreviewInfo,
  type PreviewStopResult,
} from '@dltech/atlas-protocol'
import type { CallContext, DaemonGroup, RegisteredOp } from '@dltech/atlas-protocol/engine'

import { previewsGroup } from '..'

const PRELUDE = [
  '#!/bin/sh',
  'printf "%s\\n" "$@" > "$ARGV_PATH"',
  'printf "%s" "$TUNNEL_TOKEN" > "$TOKEN_PATH"',
]

const READY_SCRIPT = [
  ...PRELUDE,
  'printf "%s\\n" "INF Registered tunnel connection connIndex=0 event=0 protocol=quic"',
  'exec sleep 60',
].join('\n')

const EXITING_SCRIPT = [
  ...PRELUDE,
  'printf "%s\\n" "mise ERROR No version is set for shim: cloudflared" >&2',
  'exit 3',
].join('\n')

const SILENT_SCRIPT = [...PRELUDE, 'echo $$ > "$PID_PATH"', 'exec sleep 60'].join('\n')

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

describe('previews ops', () => {
  let dir: string
  let argvPath: string
  let tokenPath: string
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
      envPath?: string | undefined
      previewReadyTimeoutMs?: number | undefined
    } = {},
  ): DaemonGroup => {
    const envPath = options.envPath ?? `${join(dir, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`
    return previewsGroup({
      env: { PATH: envPath, ARGV_PATH: argvPath, TOKEN_PATH: tokenPath, PID_PATH: pidPath },
      home: dir,
      cloudflaredPath: options.cloudflaredPath ?? join(dir, 'bin', 'cloudflared'),
      ...(options.previewReadyTimeoutMs === undefined
        ? {}
        : { previewReadyTimeoutMs: options.previewReadyTimeoutMs }),
    })({ publish: () => undefined })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-previews-'))
    argvPath = join(dir, 'argv.txt')
    tokenPath = join(dir, 'token.txt')
    pidPath = join(dir, 'pid.txt')
    binaryOf({ dir: join(dir, 'bin'), script: READY_SCRIPT })
    group = groupOf()
  })

  afterEach(async () => {
    await group.stop?.()
    rmSync(dir, { recursive: true, force: true })
  })

  const exposed = async (port: number, tunnelToken: string): Promise<PreviewInfo> =>
    (await runOp(group, { op: 'previews.expose', port, tunnelToken })) as PreviewInfo

  it('starts cloudflared with the token only in its environment', async () => {
    const info = await exposed(3000, 'secret-token')
    expect(info.port).toBe(3000)
    expect(info.pid).toBeGreaterThan(0)
    expect(JSON.stringify(info)).not.toContain('secret-token')
    const argv = await waitForFile(argvPath)
    expect(argv.split('\n').filter((line) => line !== '')).toEqual([
      'tunnel',
      '--no-autoupdate',
      'run',
      '--url',
      'http://127.0.0.1:3000',
    ])
    expect(argv).not.toContain('secret-token')
    expect(await waitForFile(tokenPath)).toBe('secret-token')
  })

  it('replaces a running preview for the same port', async () => {
    const first = await exposed(3000, 'one')
    const second = await exposed(3000, 'two')
    expect(second.pid).not.toBe(first.pid)
    expect(alive(first.pid)).toBe(false)
    const listed = (await runOp(group, { op: 'previews.list' })) as PreviewInfo[]
    expect(listed).toEqual([{ port: 3000, pid: second.pid }])
  })

  it('lists every port it runs', async () => {
    const web = await exposed(3000, 'one')
    const api = await exposed(4000, 'two')
    const listed = (await runOp(group, { op: 'previews.list' })) as PreviewInfo[]
    expect(listed).toEqual([
      { port: 3000, pid: web.pid },
      { port: 4000, pid: api.pid },
    ])
  })

  it('stops the process group of a port', async () => {
    const info = await exposed(3000, 'one')
    const stopped = (await runOp(group, { op: 'previews.stop', port: 3000 })) as PreviewStopResult
    expect(stopped).toEqual({ stopped: true })
    expect(alive(info.pid)).toBe(false)
    const again = (await runOp(group, { op: 'previews.stop', port: 3000 })) as PreviewStopResult
    expect(again).toEqual({ stopped: false })
    expect((await runOp(group, { op: 'previews.list' })) as PreviewInfo[]).toEqual([])
  })

  it('fails with a message naming cloudflared when the binary is missing', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    group = groupOf({ cloudflaredPath: join(empty, 'cloudflared') })
    const error = await failureOf(
      runOp(group, { op: 'previews.expose', port: 3000, tunnelToken: 'x' }),
    )
    expect(error.message).toContain('cloudflared')
    expect(error.message).toContain('cannot be published')
  })

  it('fails with the exit code and the output when cloudflared dies first', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'broken'), script: EXITING_SCRIPT }),
      envPath: join(dir, 'broken'),
    })
    const error = await failureOf(
      runOp(group, { op: 'previews.expose', port: 3000, tunnelToken: 'x' }),
    )
    expect(error.message).toContain('code 3')
    expect(error.message).toContain('No version is set for shim: cloudflared')
    expect((await runOp(group, { op: 'previews.list' })) as PreviewInfo[]).toEqual([])
  })

  it('reports only a bounded tail of a noisy failure', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'noisy'), script: NOISY_SCRIPT }),
    })
    const error = await failureOf(
      runOp(group, { op: 'previews.expose', port: 3000, tunnelToken: 'x' }),
    )
    expect(error.message).toContain('No version is set for shim')
    expect(error.message.length).toBeLessThan(3_000)
  })

  it('fails and kills cloudflared when no tunnel registers in time', async () => {
    group = groupOf({
      cloudflaredPath: binaryOf({ dir: join(dir, 'silent'), script: SILENT_SCRIPT }),
      previewReadyTimeoutMs: 200,
    })
    const error = await failureOf(
      runOp(group, { op: 'previews.expose', port: 3000, tunnelToken: 'x' }),
    )
    expect(error.message).toContain('did not register a tunnel connection')
    expect((await runOp(group, { op: 'previews.list' })) as PreviewInfo[]).toEqual([])
    const pid = Number.parseInt(await waitForFile(pidPath), 10)
    expect(await diedWithin({ pid, ms: 5_000 })).toBe(true)
  })

  it('never resolves cloudflared through PATH', async () => {
    const shimMarker = join(dir, 'shim-ran.txt')
    const shimDir = join(dir, 'shims')
    binaryOf({
      dir: shimDir,
      script: ['#!/bin/sh', `printf ran > "${shimMarker}"`, 'exit 0'].join('\n'),
    })
    group = groupOf({ envPath: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}` })
    const info = await exposed(3000, 'one')
    expect(info.port).toBe(3000)
    expect(existsSync(shimMarker)).toBe(false)
    expect(await waitForFile(argvPath)).toContain('http://127.0.0.1:3000')
  })
})
