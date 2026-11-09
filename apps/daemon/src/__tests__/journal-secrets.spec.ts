import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { ECallStatus, ERunState, type CallOp, type CallResult } from '@dltech/atlas-protocol'
import { ECallJournalState } from '@dltech/atlas-protocol/engine'
import type { DaemonSession } from '@dltech/atlas-protocol/testing'

import { DiskCallStore } from '../disk-store'
import { connectWebSocket, daemonTestEnv, daemonTestToken, spawnDaemon } from '../testing'

const ENTRY = join(import.meta.dir, '../index.ts')
const EPOCH = 3
const SECRET = 'ghs_journalsecret0123456789abcdef'
const ENV_KEY = 'k-journal-env'
const FILE_KEY = 'k-journal-file'

type Boot = { child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>; port: number; home: string }

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const boot = async (root: string): Promise<Boot> => {
  const { child, port } = await spawnDaemon({ entry: ENTRY, env: daemonTestEnv(root) })
  cleanups.push(() => child.kill('SIGKILL'))
  return { child, port, home: join(root, 'daemon') }
}

const connect = async (port: number): Promise<DaemonSession> => {
  const session = await connectWebSocket(port)
  cleanups.push(() => session.close())
  session.send({
    kind: 'hello',
    sessionId: 'journal-secrets',
    epoch: EPOCH,
    token: daemonTestToken(),
  })
  await session.until((frame) => frame.kind === 'hello-reply', { label: 'hello-reply' })
  return session
}

const run = async (args: {
  session: DaemonSession
  key: string
  op: CallOp
}): Promise<{ state: ERunState; result: CallResult }> => {
  args.session.send({ kind: 'run', key: args.key, epoch: EPOCH, op: args.op })
  const reply = await args.session.until(
    (frame) => frame.kind === 'run-reply' && frame.key === args.key,
    { label: `run-reply ${args.key}` },
  )
  const result = await args.session.until(
    (frame) => frame.kind === 'result' && frame.key === args.key,
    { label: `result ${args.key}` },
  )
  if (reply.kind !== 'run-reply' || result.kind !== 'result') throw new Error('unreachable')
  return { state: reply.state, result: result.result }
}

const ack = async (args: { session: DaemonSession; key: string }): Promise<void> => {
  args.session.send({ kind: 'ack', key: args.key, epoch: EPOCH })
  await args.session.until((frame) => frame.kind === 'acked' && frame.key === args.key, {
    label: `acked ${args.key}`,
  })
}

const runsOf = async (session: DaemonSession): Promise<number> => {
  session.send({ kind: 'ping' })
  const pong = await session.until((frame) => frame.kind === 'pong', { label: 'pong' })
  return pong.kind === 'pong' ? pong.runs : -1
}

const filesUnder = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))

const holdersOf = (root: string, needle: string): string[] =>
  filesUnder(root).filter((file) => readFileSync(file, 'utf8').includes(needle))

describe('daemon call journal secrets', () => {
  it('writes no secret env value or writeFile content to the journal, and still adopts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-daemon-journal-secret-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const envOp: CallOp = {
      op: 'exec',
      argv: ['/bin/sh', '-c', 'true'],
      env: { GH_TOKEN: SECRET, GIT_CONFIG_COUNT: '0' },
    }
    const fileOp: CallOp = {
      op: 'writeFile',
      path: join(root, 'workspace-github-token'),
      content: SECRET,
      mode: 0o600,
    }

    let running = await boot(root)
    const session = await connect(running.port)
    const firstEnv = await run({ session, key: ENV_KEY, op: envOp })
    const firstFile = await run({ session, key: FILE_KEY, op: fileOp })
    expect([firstEnv.result.status, firstFile.result.status]).toEqual([
      ECallStatus.Ok,
      ECallStatus.Ok,
    ])

    const store = new DiskCallStore(running.home)
    expect(await store.readState({ key: ENV_KEY })).toMatchObject({
      state: ECallJournalState.Done,
      op: { op: 'exec', env: { GH_TOKEN: '[redacted]', GIT_CONFIG_COUNT: '[redacted]' } },
    })
    expect(await store.readState({ key: FILE_KEY })).toMatchObject({
      state: ECallJournalState.Done,
      op: { op: 'writeFile', content: '[redacted]', mode: 0o600 },
    })
    expect(holdersOf(running.home, SECRET)).toEqual([])

    running.child.kill('SIGKILL')
    await running.child.exited
    running = await boot(root)
    const again = await connect(running.port)
    expect(await run({ session: again, key: ENV_KEY, op: envOp })).toEqual({
      state: ERunState.Done,
      result: firstEnv.result,
    })
    expect(await run({ session: again, key: FILE_KEY, op: fileOp })).toEqual({
      state: ERunState.Done,
      result: firstFile.result,
    })
    expect(await runsOf(again)).toBe(0)

    await ack({ session: again, key: ENV_KEY })
    await ack({ session: again, key: FILE_KEY })
    expect(await store.readState({ key: ENV_KEY })).toBeUndefined()
    expect(await store.readState({ key: FILE_KEY })).toBeUndefined()
  }, 60_000)
})
