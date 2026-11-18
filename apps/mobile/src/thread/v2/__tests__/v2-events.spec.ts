import { describe, expect, it } from 'bun:test'

import {
  createSessionFollower,
  memorySessionLog,
  transcriptEventsOf,
} from '@dltech/atlas-client/stream'
import type { StreamScheduler } from '@dltech/atlas-client/stream'
import { ESkillOrigin } from '@dltech/atlas-plugin-skills/core'

import { v2EventSchema, v2EventTypes } from '../registered-plugins'

const envelope = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: 'thr_1',
  runId: 'run_1',
  depth: 0,
  at: `2026-11-08T20:00:0${seq}.000Z`,
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const skillsChanged = {
  ...envelope(1),
  type: 'skills-changed',
  skills: [
    {
      name: 'release-notes',
      description: 'write the release notes',
      argumentHint: null,
      origin: ESkillOrigin.Repo,
    },
  ],
}

const scheduler: StreamScheduler = {
  now: () => Date.parse('2026-11-18T12:00:00.000Z'),
  setTimeout: () => undefined,
  clearTimeout: () => undefined,
  random: () => 0,
}

describe('the v2 bodies this app reads', () => {
  it('parses a body a plugin writes', () => {
    const parsed = v2EventSchema.safeParse({
      ...envelope(1),
      type: 'service-ready',
      serviceId: 'svc-1',
    })
    expect(parsed.success).toBe(true)
  })

  it('keeps the message when the page also holds a plugin body', () => {
    const said = v2EventSchema.parse({ ...envelope(1), type: 'user-said', text: 'hello' })
    const ready = v2EventSchema.parse({
      ...envelope(2),
      type: 'service-ready',
      serviceId: 'svc-1',
    })
    expect(transcriptEventsOf([said, ready]).map((event) => event.type)).toEqual(['user-said'])
  })

  it('refuses a body no plugin on this app knows', () => {
    const parsed = v2EventSchema.safeParse({ ...envelope(1), type: 'from-the-future' })
    expect(parsed.success).toBe(false)
  })

  it('reads the skills catalogue a pod pushes', () => {
    expect(v2EventSchema.safeParse(skillsChanged).success).toBe(true)
  })

  it('leaves the writer-ahead banner down for a host that announces a skills change', () => {
    const follower = createSessionFollower({
      sessionId: 'thr_1',
      log: memorySessionLog(),
      scheduler,
      onResnap: () => undefined,
      knownEventTypes: v2EventTypes,
    })

    follower.setServerEventTypes(['skills-changed', 'service-ready'])

    expect(follower.getSnapshot().writerAhead).toBe(false)
  })
})
