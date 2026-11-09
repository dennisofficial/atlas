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

const SCRIPT = ['#!/bin/sh', 'printf "%s\\n" "$@" > "$ARGV_PATH"', 'sleep 60'].join('\n')

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

describe('previews ops', () => {
  let dir: string
  let argvPath: string
  let group: DaemonGroup

  const groupWith = (path: string): DaemonGroup =>
    previewsGroup({ env: { PATH: path, ARGV_PATH: argvPath }, home: dir })({
      publish: () => undefined,
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-previews-'))
    argvPath = join(dir, 'argv.txt')
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const script = join(bin, 'cloudflared')
    writeFileSync(script, SCRIPT)
    chmodSync(script, 0o755)
    group = groupWith(`${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`)
  })

  afterEach(async () => {
    await group.stop?.()
    rmSync(dir, { recursive: true, force: true })
  })

  const exposed = async (port: number, tunnelToken: string): Promise<PreviewInfo> =>
    (await runOp(group, { op: 'previews.expose', port, tunnelToken })) as PreviewInfo

  it('starts cloudflared with the token only in its argv', async () => {
    const info = await exposed(3000, 'secret-token')
    expect(info.port).toBe(3000)
    expect(info.pid).toBeGreaterThan(0)
    expect(JSON.stringify(info)).not.toContain('secret-token')
    const argv = await waitForFile(argvPath)
    expect(argv.split('\n').filter((line) => line !== '')).toEqual([
      'tunnel',
      '--no-autoupdate',
      'run',
      '--token',
      'secret-token',
      '--url',
      'http://127.0.0.1:3000',
    ])
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
    const error = await runOp(groupWith(empty), {
      op: 'previews.expose',
      port: 3000,
      tunnelToken: 'x',
    }).catch((caught: unknown) => caught)
    expect(error instanceof CallFailureError).toBe(true)
    expect(error instanceof Error ? error.message : '').toContain('cloudflared')
  })
})
