import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EToolEffect, NoticePort, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest } from '@dltech/atlas-harness'
import { EChangeScope, EChangeStatus } from '@dltech/atlas-wire'

import { composeServeApp } from '../compose-serve'
import type { ReplyFrame, RequestFrame } from '../request-reply'
import type { ServeApp } from '../serve-app'
import { routeSessionToolRequest } from '../session-tool-routing'
import type { SessionTools } from '../session-tool-requests'

class SilentNotices extends NoticePort {
  notify(): void {}
}

const composed: ServeApp[] = []
const roots: string[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  while (composed.length > 0) await composed.pop()?.close()
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const temp = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `atlas-compose-serve-${name}-`))
  roots.push(dir)
  return dir
}

/** A repo whose one tracked file is committed and then edited, so the uncommitted scope names it. */
const repo = (file: string): string => {
  const dir = temp('repo')
  const git = (...argv: string[]): void => {
    execFileSync('git', argv, { cwd: dir, stdio: 'ignore' })
  }
  git('init', '-q')
  git('config', 'user.email', 'compose-serve@example.com')
  git('config', 'user.name', 'compose-serve spec')
  writeFileSync(join(dir, file), 'export const value = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(dir, file), 'export const value = 2\n')
  return dir
}

const session = async (args: {
  threadId: ThreadId
  file: string
}): Promise<{ app: ServeApp; cwd: string; tools: SessionTools }> => {
  const cwd = repo(args.file)
  heldAtlasHome ??= process.env.ATLAS_HOME
  process.env.ATLAS_HOME = temp('home')
  const app = await composeServeApp({
    threadId: args.threadId,
    cwd,
    controlPlaneUrl: 'https://api.example.com',
    token: 'session-token',
    clientVersion: 'compose-serve-spec',
    env: {},
    model: undefined,
    notice: new SilentNotices(),
  })
  composed.push(app)
  return { app, cwd, tools: { changes: app.changes, terminal: app.terminal } }
}

let asked = 0
const ask = (args: { tools: SessionTools; op: EClientRequest; params: unknown }) => {
  asked += 1
  const frame: RequestFrame = {
    kind: EClientFrame.Request,
    id: `compose-serve-${asked}`,
    op: args.op,
    params: args.params,
  }
  const reply = new Promise<ReplyFrame>((resolve) => {
    const claimed = routeSessionToolRequest({ frame, tools: args.tools, reply: resolve })
    if (!claimed) throw new Error(`${args.op} was not routed to the session tools`)
  })
  return reply
}

const changedPaths = (reply: ReplyFrame): string[] => {
  if (!reply.ok) throw new Error(`refused: ${JSON.stringify(reply.data)}`)
  const data = reply.data as { files: readonly { path: string; status: EChangeStatus }[] }
  return data.files.map((file) => file.path)
}

const dataOf = (reply: ReplyFrame): Record<string, unknown> => {
  if (!reply.ok) throw new Error(`refused: ${JSON.stringify(reply.data)}`)
  return reply.data as Record<string, unknown>
}

const required = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`composeServeApp omitted ${what}`)
  return value
}

describe('composeServeApp session tools', () => {
  it("answers read-git-changes from the served session's own workspace", async () => {
    const alpha = await session({ threadId: toThreadId('thread-compose-alpha'), file: 'alpha.ts' })
    const beta = await session({ threadId: toThreadId('thread-compose-beta'), file: 'beta.ts' })

    const fromAlpha = await ask({
      tools: alpha.tools,
      op: EClientRequest.ReadGitChanges,
      params: { scope: EChangeScope.Uncommitted },
    })
    const fromBeta = await ask({
      tools: beta.tools,
      op: EClientRequest.ReadGitChanges,
      params: { scope: EChangeScope.Uncommitted },
    })

    expect(changedPaths(fromAlpha)).toEqual(['alpha.ts'])
    expect(changedPaths(fromBeta)).toEqual(['beta.ts'])
  })

  it('answers the terminal ops from the composed session terminal and refuses a stale id', async () => {
    const { tools } = await session({
      threadId: toThreadId('thread-compose-terminal'),
      file: 'terminal.ts',
    })

    const opened = dataOf(
      await ask({ tools, op: EClientRequest.TerminalOpen, params: { cols: 80, rows: 24 } }),
    )
    const terminalId = String(opened.terminalId)

    expect(
      dataOf(
        await ask({
          tools,
          op: EClientRequest.TerminalResize,
          params: { terminalId, cols: 100, rows: 30 },
        }),
      ),
    ).toEqual({ done: true })
    expect(
      dataOf(
        await ask({
          tools,
          op: EClientRequest.TerminalWrite,
          params: { terminalId, data: 'true\n' },
        }),
      ),
    ).toEqual({ done: true })
    expect(
      dataOf(await ask({ tools, op: EClientRequest.TerminalClose, params: { terminalId } })),
    ).toEqual({ done: true })
    expect(
      dataOf(
        await ask({
          tools,
          op: EClientRequest.TerminalWrite,
          params: { terminalId, data: 'true\n' },
        }),
      ),
    ).toEqual({ done: false })
  })

  it('declines an op that is not a session tool request', () => {
    const tools: SessionTools = {}
    const frame: RequestFrame = {
      kind: EClientFrame.Request,
      id: 'compose-serve-not-session-tool',
      op: EClientRequest.BrowseDirectory,
      params: { path: '' },
    }
    const claimed = routeSessionToolRequest({
      frame,
      tools,
      reply: (reply: ReplyFrame) => {
        throw new Error(`unexpected reply ${JSON.stringify(reply)}`)
      },
    })

    expect(claimed).toBe(false)
  })

  it('refuses read-git-changes when the session was composed without the changes port', async () => {
    const { tools } = await session({
      threadId: toThreadId('thread-compose-bare'),
      file: 'bare.ts',
    })

    const reply = await ask({
      tools: { terminal: tools.terminal },
      op: EClientRequest.ReadGitChanges,
      params: { scope: EChangeScope.Uncommitted },
    })

    expect(reply.ok).toBe(false)
  })
})

describe('composeServeApp composition', () => {
  it('composes the session around its own workspace and tool effects', async () => {
    const { app, cwd } = await session({
      threadId: toThreadId('thread-compose-idle'),
      file: 'idle.ts',
    })

    expect(required(app.subscriptions, 'subscriptions').projectDirectory).toBe(cwd)
    expect(required(app.toolEffect, 'toolEffect')('skill')).toBe(EToolEffect.Read)
    expect(required(app.toolEffect, 'toolEffect')('no-such-tool')).toBeUndefined()

    const mentions = await required(
      app.mentionFiles,
      'mentionFiles',
    )(toThreadId('thread-compose-idle'))
    expect(await mentions.exists('idle.ts')).toBe(true)

    expect(required(app.pendingInput, 'pendingInput')()).toBe(false)
    expect(required(app.settlingWork, 'settlingWork')()).toBe(false)
    expect(required(app.runningChildren, 'runningChildren')()).toBe(0)
    expect(required(app.runningShells, 'runningShells')()).toBe(0)
    expect(required(app.runningServices, 'runningServices')()).toBe(0)
    expect(required(app.roster, 'roster').snapshot()).toEqual({
      shells: [],
      agents: [],
      services: [],
    })
    expect(await required(app.mcp, 'mcp').list({ refresh: false })).toEqual([])
  })
})
