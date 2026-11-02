import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { EAgentStatus } from '@dltech/atlas-core'
import { EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import { ECapability, ETurnStatus } from '@dltech/atlas-wire'

import {
  agentParams,
  attach,
  buffer,
  handlers,
  legacyActivity,
  legacyOutcome,
  legacySnapshot,
  request,
  statusesOf,
  threadId,
  waitingOutcome,
} from './model-availability-egress-fixture'

describe('serve egress for a peer without model-availability-controls', () => {
  it('downconverts the list-roster reply to a Paused agent an old schema parses', async () => {
    const peer = await attach(undefined)
    const reply = await request({ peer, op: EClientRequest.ListRoster, params: {} })
    expect(statusesOf(reply.data)).toEqual([EAgentStatus.Paused])
    const parsed = z.object({ agents: z.array(legacySnapshot) }).safeParse(reply.data)
    expect(parsed.success).toBe(true)
  })

  it('downconverts the roster broadcast', async () => {
    const peer = await attach([ECapability.ReadActivity])
    peer.clear()
    handlers.broadcastRoster()
    const frame = peer.frames()[0] as { kind: string; roster: unknown }
    expect(frame.kind).toBe(EServeFrame.Roster)
    expect(z.object({ agents: z.array(legacySnapshot) }).safeParse(frame.roster).success).toBe(true)
    expect(statusesOf(frame.roster)).toEqual([EAgentStatus.Paused])
  })

  it('downconverts say, resume and stop agent replies', async () => {
    const peer = await attach(undefined)
    for (const op of [EClientRequest.ResumeAgent, EClientRequest.StopAgent]) {
      const reply = await request({ peer, op, params: agentParams })
      const parsed = z
        .object({ ok: z.literal(true), snapshot: legacySnapshot })
        .safeParse(reply.data)
      expect(parsed.success).toBe(true)
      expect(parsed.data?.snapshot.status).toBe(EAgentStatus.Paused)
    }
    const said = await request({
      peer,
      op: EClientRequest.SayToAgent,
      params: { ...agentParams, text: 'go on' },
    })
    expect(
      z.object({ ok: z.literal(true), snapshot: legacySnapshot }).safeParse(said.data).success,
    ).toBe(true)
  })

  it('strips the waiting field from the read-activity reply', async () => {
    const peer = await attach(undefined)
    const reply = await request({
      peer,
      op: EClientRequest.ReadActivity,
      params: { threadId },
    })
    expect(legacyActivity.safeParse(reply.data).success).toBe(true)
    expect(reply.data).not.toHaveProperty('waitingForModel')
  })

  it('sends a broadcast waiting turn outcome as a Failed outcome with waiting text', async () => {
    const peer = await attach(undefined)
    peer.clear()
    handlers.broadcast(
      buffer.pushLifecycle({ kind: EServeFrame.TurnEnded, outcome: waitingOutcome }),
    )
    const frame = peer.frames()[0] as { kind: string; outcome: unknown }
    expect(frame.kind).toBe(EServeFrame.TurnEnded)
    const parsed = legacyOutcome.parse(frame.outcome)
    expect(parsed.status).toBe(ETurnStatus.Failed)
    expect(parsed.message).toContain('Waiting for model')
  })

  it('downconverts a waiting outcome replayed from the buffer to a reconnecting legacy peer', async () => {
    const anchor = buffer.push({ type: 'events-appended' })
    handlers.broadcast(
      buffer.pushLifecycle({ kind: EServeFrame.TurnEnded, outcome: waitingOutcome }),
    )
    const peer = await attach(undefined, anchor.seq)
    const replayed = peer
      .frames()
      .filter((frame) => (frame as { kind: string }).kind === EServeFrame.TurnEnded)
    expect(replayed.length).toBeGreaterThan(0)
    for (const frame of replayed) {
      expect(legacyOutcome.safeParse((frame as { outcome: unknown }).outcome).success).toBe(true)
    }
  })
})
