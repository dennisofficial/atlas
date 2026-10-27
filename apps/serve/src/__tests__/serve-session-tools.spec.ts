import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import {
  BunTerminalPort,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  GitChangesPort,
  type ServeFrame,
} from '@dltech/atlas-harness'
import { EChangeScope, EChangeStatus, EPendingEdit } from '@dltech/atlas-wire'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp, type FakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-session-tools')

const homes: string[] = []
const running: ServeHandle[] = []
const terminals: BunTerminalPort[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  await Promise.all(terminals.splice(0).map((port) => port.closeAll()))
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

class StubChanges extends GitChangesPort {
  scopes: EChangeScope[] = []
  async read({ scope }: { scope: EChangeScope }) {
    this.scopes.push(scope)
    return {
      scope,
      base: 'abc123',
      truncated: false,
      files: [
        {
          path: 'src/a.ts',
          status: EChangeStatus.Modified,
          additions: 1,
          deletions: 0,
          binary: false,
          truncated: false,
          hunks: [],
        },
      ],
    }
  }
}

const start = async (args: { withTools?: boolean } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-tools-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app: FakeServeApp = fakeServeApp({ threadId, root: '/workspace' })
  const changes = new StubChanges()
  const terminal = new BunTerminalPort({
    root: home,
    env: { SHELL: '/bin/sh', PATH: process.env.PATH, PS1: '' },
  })
  terminals.push(terminal)
  const tools = args.withTools === false ? {} : { changes, terminal }
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: {},
    cwd: '/workspace',
    compose: async () => ({ ...app, ...tools }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  running.push(handle)
  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { app, client, changes }
}

let counter = 0
const ask = async (args: { client: TestClient; op: EClientRequest; params: unknown }) => {
  counter += 1
  const id = `req-${counter}`
  args.client.send({ kind: EClientFrame.Request, id, op: args.op, params: args.params })
  return await args.client.waitFor(
    (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === id,
  )
}

const dataOf = (frame: ServeFrame): Record<string, unknown> => {
  if (frame.kind !== EServeFrame.Reply || !frame.ok) throw new Error('expected an ok reply')
  return frame.data as Record<string, unknown>
}

describe('the read-git-changes op', () => {
  it('answers the scoped changes from the harness port', async () => {
    const { client, changes } = await start()

    const reply = await ask({
      client,
      op: EClientRequest.ReadGitChanges,
      params: { scope: EChangeScope.LastCommit },
    })

    expect(dataOf(reply)).toMatchObject({ scope: 'last-commit', files: [{ path: 'src/a.ts' }] })
    expect(changes.scopes).toEqual([EChangeScope.LastCommit])
  })

  it('refuses a bad scope, and a serve without the port', async () => {
    const { client } = await start()
    expect(
      await ask({ client, op: EClientRequest.ReadGitChanges, params: { scope: 'staged' } }),
    ).toMatchObject({ ok: false })

    const bare = await start({ withTools: false })
    expect(
      await ask({
        client: bare.client,
        op: EClientRequest.ReadGitChanges,
        params: { scope: 'all' },
      }),
    ).toMatchObject({ ok: false })
  })
})

describe('the terminal ops', () => {
  it('opens a pty, streams output frames, resizes, writes, closes and announces the exit', async () => {
    const { client } = await start()

    const opened = dataOf(
      await ask({ client, op: EClientRequest.TerminalOpen, params: { cols: 90, rows: 20 } }),
    )
    const terminalId = String(opened.terminalId)

    expect(
      dataOf(
        await ask({
          client,
          op: EClientRequest.TerminalResize,
          params: { terminalId, cols: 100, rows: 25 },
        }),
      ),
    ).toEqual({ done: true })
    expect(
      dataOf(
        await ask({
          client,
          op: EClientRequest.TerminalWrite,
          params: { terminalId, data: 'stty size\n' },
        }),
      ),
    ).toEqual({ done: true })
    await client.waitFor(
      (frame) =>
        frame.kind === EServeFrame.TerminalOutput &&
        frame.terminalId === terminalId &&
        client.frames.some(
          (seen) => seen.kind === EServeFrame.TerminalOutput && seen.data.includes('25 100'),
        ),
    )

    expect(
      dataOf(await ask({ client, op: EClientRequest.TerminalClose, params: { terminalId } })),
    ).toEqual({
      done: true,
    })
    await client.waitFor(
      (frame) => frame.kind === EServeFrame.TerminalExit && frame.terminalId === terminalId,
    )
  })

  it('answers done:false for an unknown terminal and refuses malformed params', async () => {
    const { client } = await start()

    expect(
      dataOf(
        await ask({
          client,
          op: EClientRequest.TerminalWrite,
          params: { terminalId: 'nope', data: 'x' },
        }),
      ),
    ).toEqual({ done: false })
    expect(
      await ask({ client, op: EClientRequest.TerminalOpen, params: { cols: 0, rows: 0 } }),
    ).toMatchObject({ ok: false })
  })

  it('refuses when the serve has no terminal', async () => {
    const { client } = await start({ withTools: false })
    expect(
      await ask({ client, op: EClientRequest.TerminalOpen, params: { cols: 80, rows: 24 } }),
    ).toMatchObject({ ok: false })
  })
})

describe('the update-pending and remove-pending ops', () => {
  it('edits and removes a queued entry and broadcasts each change', async () => {
    const { app, client } = await start()
    const queue = app.pending?.forThread({ threadId })
    queue?.enqueue({ text: 'first' })
    queue?.enqueue({ text: 'second' })
    const [first, second] = queue?.getSnapshot() ?? []

    const updated = await ask({
      client,
      op: EClientRequest.UpdatePending,
      params: { threadId, id: first?.id, text: 'first, edited' },
    })
    expect(dataOf(updated)).toEqual({ outcome: EPendingEdit.Done })
    await client.waitFor(
      (frame) =>
        frame.kind === EServeFrame.Signal &&
        frame.signal.type === 'pending-changed' &&
        frame.signal.entries[0]?.text === 'first, edited',
    )

    const removed = await ask({
      client,
      op: EClientRequest.RemovePending,
      params: { threadId, id: second?.id },
    })
    expect(dataOf(removed)).toEqual({ outcome: EPendingEdit.Done })
    expect(queue?.getSnapshot().map((entry) => entry.text)).toEqual(['first, edited'])
  })

  it('honours the reserved rule and reports unknown ids', async () => {
    const { app, client } = await start()
    const queue = app.pending?.forThread({ threadId })
    queue?.enqueue({ text: 'in flight' })
    const [held] = queue?.getSnapshot() ?? []
    queue?.prepare()

    expect(
      dataOf(
        await ask({
          client,
          op: EClientRequest.UpdatePending,
          params: { threadId, id: held?.id, text: 'x' },
        }),
      ),
    ).toEqual({ outcome: EPendingEdit.Reserved })
    expect(
      dataOf(
        await ask({ client, op: EClientRequest.RemovePending, params: { threadId, id: held?.id } }),
      ),
    ).toEqual({ outcome: EPendingEdit.Reserved })
    expect(
      dataOf(
        await ask({
          client,
          op: EClientRequest.RemovePending,
          params: { threadId, id: 'pending-99' },
        }),
      ),
    ).toEqual({ outcome: EPendingEdit.Missing })
    expect(queue?.getSnapshot().map((entry) => entry.text)).toEqual(['in flight'])
  })

  it('refuses malformed params', async () => {
    const { client } = await start()
    expect(
      await ask({ client, op: EClientRequest.UpdatePending, params: { threadId } }),
    ).toMatchObject({
      ok: false,
    })
    expect(await ask({ client, op: EClientRequest.RemovePending, params: {} })).toMatchObject({
      ok: false,
    })
  })
})
