import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EServiceStatus,
  EShellStatus,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'
import { type RosterWire } from '@dltech/atlas-wire'

import { EClientFrame, EClientRequest, EServeFrame, ETurnStatus } from '@dltech/atlas-harness'
import { EServeEvent } from '../index'

import { connect } from './client'
import { fakeRoster } from './fakes'
import {
  gate,
  hello,
  releaseServeSpec,
  start,
  threadId,
  TOKEN,
  wakeNoticesOf,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  describe('an ending that lands while no client is attached', () => {
    it('starts a turn on a shell ending rather than waiting for a Send', async () => {
      let turns = 0
      const { app, lines } = await start({
        wakeNotices: true,
        runTurn: async () => {
          turns += 1
          return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
        },
      })

      wakeNoticesOf(app).setPending({ shells: 1 })

      for (let waited = 0; waited < 2000; waited += 1) {
        if (turns > 0) break
        await Bun.sleep(1)
      }

      expect(turns).toBe(1)
      expect(lines.some((line) => line.includes(EServeEvent.TurnStarted))).toBe(true)
    })

  describe('the roster a watching surface reads', () => {
    it('answers a list-roster request with the live registry state', async () => {
      const roster = fakeRoster({
        shells: [
          {
            shellId: 'bash_1' as RosterWire['shells'][number]['shellId'],
            threadId,
            command: 'npm run dev',
            description: 'dev server',
            status: EShellStatus.Running,
            startedAt: '2026-09-24T10:00:00.000Z',
            lastOutputAt: '2026-09-24T10:00:01.000Z',
            totalCharacters: 120,
            awaitingInput: false,
          },
        ],
        agents: [
          {
            agentId: toThreadId('child-explore'),
            spawnedBy: threadId,
            agentType: 'explore',
            intent: 'find the seam',
            status: EAgentStatus.Running,
            turns: 2,
            toolCalls: 5,
            lastTool: undefined,
            startedAt: '2026-09-24T10:00:00.000Z',
            endedAt: undefined,
          },
        ],
        services: [],
      })
      const { handle } = await start({ roster })

      const client = await connect({ port: handle.port, token: TOKEN })
      client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

      client.send({
        kind: EClientFrame.Request,
        id: 'roster-1',
        op: EClientRequest.ListRoster,
        params: {},
      })
      const reply = await client.waitFor(
        (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'roster-1',
      )

      expect(reply).toMatchObject({
        ok: true,
        data: {
          shells: [{ shellId: 'bash_1', status: 'running' }],
          agents: [{ agentId: 'child-explore', agentType: 'explore' }],
          services: [],
        },
      })
    })

    it('pushes a roster frame to attached clients the moment the registry changes', async () => {
      const roster = fakeRoster()
      const { handle } = await start({ roster })

      const client = await connect({ port: handle.port, token: TOKEN })
      client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

      roster.change({
        shells: [],
        agents: [],
        services: [
          {
            serviceId: 'svc_1',
            command: 'redis-server',
            description: 'cache',
            status: EServiceStatus.Running,
            logPath: '/tmp/svc_1.log',
            startedAt: '2026-09-24T10:00:00.000Z',
          },
        ],
      })

      const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.Roster)
      expect(pushed).toEqual({
        kind: EServeFrame.Roster,
        roster: {
          shells: [],
          agents: [],
          services: [
            expect.objectContaining({ serviceId: 'svc_1', status: 'running' }),
          ],
        },
      })
    })

    it('pushes the removal when an entry leaves the registry — a cleared ending, not silence', async () => {
      const live: RosterWire = {
        shells: [],
        agents: [
          {
            agentId: toThreadId('child-explore'),
            spawnedBy: threadId,
            agentType: 'explore',
            intent: 'find the seam',
            status: EAgentStatus.Running,
            turns: 2,
            toolCalls: 5,
            lastTool: undefined,
            startedAt: '2026-09-24T10:00:00.000Z',
            endedAt: undefined,
          },
        ],
        services: [],
      }
      const roster = fakeRoster(live)
      const { handle } = await start({ roster })

      const client = await connect({ port: handle.port, token: TOKEN })
      client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

      roster.change({ ...live, agents: [] })

      const pushed = await client.waitFor((frame) => frame.kind === EServeFrame.Roster)
      expect(pushed).toEqual({
        kind: EServeFrame.Roster,
        roster: { shells: [], agents: [], services: [] },
      })
    })

    it('answers an empty roster when the app composes without registries', async () => {
      const { handle } = await start({})

      const client = await connect({ port: handle.port, token: TOKEN })
      client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

      client.send({
        kind: EClientFrame.Request,
        id: 'roster-2',
        op: EClientRequest.ListRoster,
        params: {},
      })
      const reply = await client.waitFor(
        (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'roster-2',
      )

      expect(reply).toMatchObject({
        ok: true,
        data: { shells: [], agents: [], services: [] },
      })
    })
  })

    it('holds the wake while a turn is already running — the loop drains the queue itself', async () => {
      const held = gate()
      let turns = 0
      const { handle, app } = await start({
        wakeNotices: true,
        runTurn: async () => {
          turns += 1
          await held.opened
          return { status: ETurnStatus.Completed, runId: toRunId(`run-${turns}`) }
        },
      })

      const client = await connect({ port: handle.port, token: TOKEN })
      client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
      client.send({ kind: EClientFrame.Run })
      await Bun.sleep(10)

      wakeNoticesOf(app).setPending({ shells: 1 })
      await Bun.sleep(10)
      expect(turns).toBe(1)

      held.open()
      wakeNoticesOf(app).setPending({ shells: 0 })
      await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
      expect(turns).toBe(1)
    })
  })
})
