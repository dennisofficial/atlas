import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'
import { EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import { ECapability, ETurnStatus, readActivityReplySchema } from '@dltech/atlas-wire'

import {
  agentParams,
  attach,
  buffer,
  handlers,
  request,
  statusesOf,
  threadId,
  waiting,
  waitingOutcome,
} from './model-availability-egress-fixture'

describe('serve egress for a peer advertising model-availability-controls', () => {
  const capable = [ECapability.ModelAvailabilityControls]

  it('hands the untranslated enum to every path', async () => {
    const peer = await attach(capable)
    const listed = await request({ peer, op: EClientRequest.ListRoster, params: {} })
    expect(statusesOf(listed.data)).toEqual([EAgentStatus.WaitingForModel])

    const resumed = await request({ peer, op: EClientRequest.ResumeAgent, params: agentParams })
    expect((resumed.data as { snapshot: { status: string } }).snapshot.status).toBe(
      EAgentStatus.WaitingForModel,
    )

    const read = await request({ peer, op: EClientRequest.ReadActivity, params: { threadId } })
    expect(readActivityReplySchema.parse(read.data).waitingForModel).toEqual(waiting)

    peer.clear()
    handlers.broadcastRoster()
    expect(statusesOf((peer.frames()[0] as { roster: unknown }).roster)).toEqual([
      EAgentStatus.WaitingForModel,
    ])

    peer.clear()
    handlers.broadcast(
      buffer.pushLifecycle({ kind: EServeFrame.TurnEnded, outcome: waitingOutcome }),
    )
    const ended = peer.frames()[0] as { outcome: { status: string } }
    expect(ended.outcome.status).toBe(ETurnStatus.WaitingForModel)
  })

  it('translates per peer when capable and legacy peers are attached together', async () => {
    const modern = await attach(capable)
    const old = await attach(undefined)
    modern.clear()
    old.clear()
    handlers.broadcastRoster()
    expect(statusesOf((modern.frames()[0] as { roster: unknown }).roster)).toEqual([
      EAgentStatus.WaitingForModel,
    ])
    expect(statusesOf((old.frames()[0] as { roster: unknown }).roster)).toEqual([
      EAgentStatus.Paused,
    ])
  })
})
