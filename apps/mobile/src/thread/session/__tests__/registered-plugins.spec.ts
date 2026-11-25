import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createSessionFollower,
  memorySessionLog,
  type StreamScheduler,
} from '@dltech/atlas-client/stream'
import { eventsMessage, headOf, mintEvents, userSaid } from '@dltech/atlas-client/stream-fixture'
import { streamServerMessageSchema } from '@dltech/atlas-protocol'

import { registeredPluginNames, eventSchema, eventTypes } from '../registered-plugins'

const WEB_REGISTRY = join(
  import.meta.dir,
  '../../../../../web/src/features/sessions/registered-plugins.ts',
)

const MISSING_BEFORE_THE_FIX = [
  'mcp-server-changed',
  'mcp-server-removed',
  'mcp-sign-in-started',
  'mcp-sign-in-resolved',
  'operator-input-asked',
  'operator-input-settled',
]

const scheduler: StreamScheduler = {
  now: () => Date.parse('2026-11-18T12:00:00.000Z'),
  setTimeout: () => undefined,
  clearTimeout: () => undefined,
  random: () => 0,
}

const pluginNamesOf = (source: string): readonly string[] =>
  [...source.matchAll(/name: '([a-z-]+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )

describe('the plugins this app reads', () => {
  it('registers the same plugins as the web session surface', () => {
    const web = pluginNamesOf(readFileSync(WEB_REGISTRY, 'utf8'))
    expect(web.length).toBeGreaterThan(0)
    expect([...registeredPluginNames].sort()).toEqual([...web].sort())
  })

  it('reads the mcp and operator bodies the pod writes', () => {
    for (const type of MISSING_BEFORE_THE_FIX) expect(eventTypes.has(type)).toBe(true)
  })

  it('skips no event of a page that carries an mcp body, so the stale card stays down', () => {
    const follower = createSessionFollower({
      sessionId: 'thread-1',
      log: memorySessionLog(),
      scheduler,
      onResnap: () => undefined,
      eventSchema: eventSchema,
      knownEventTypes: eventTypes,
    })
    const events = mintEvents({
      bodies: [{ type: 'mcp-server-removed', name: 'linear' }, userSaid('hello')],
    })

    follower.handleMessage(eventsMessage({ id: 's1', events, live: true }))

    expect(follower.getSnapshot().skipped).toBe(0)
  })
})

describe('the page frame the API sends', () => {
  it('loads the screen when the frame carries a field this build does not know', () => {
    const events = mintEvents({ bodies: [userSaid('Say hi in one word.')] })
    const head = headOf(events)
    const wire = JSON.stringify({
      type: 'events',
      id: 'sub-1',
      events,
      head,
      cursor: head,
      live: true,
      tailVersion: 14,
    })
    const frame = streamServerMessageSchema.parse(JSON.parse(wire))
    const follower = createSessionFollower({
      sessionId: 'thread-1',
      log: memorySessionLog(),
      scheduler,
      onResnap: () => undefined,
      eventSchema: eventSchema,
      knownEventTypes: eventTypes,
    })

    follower.handleMessage(frame)

    const snapshot = follower.getSnapshot()
    expect(snapshot.events.map((event) => event.seq)).toEqual([1])
    expect(snapshot.cursor).toEqual(head)
    expect(snapshot.skipped).toBe(0)
  })
})
