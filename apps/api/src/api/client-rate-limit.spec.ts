import 'reflect-metadata'
import { describe, expect, it } from 'bun:test'
import { CLIENT_READ_LIMIT_PER_MINUTE } from './client-rate-limit'
import { ProjectWorkspaceController } from './cloud/projects/project-workspace.controller'
import { SandboxesController } from './platform/sandboxes/sandboxes.controller'
import { procedureMetaOf } from './platform/sessions/procedure-meta.fixture'
import { ThreadEventsRouter } from './platform/sessions/thread-events.router'
import { ThreadTurnsRouter } from './platform/sessions/thread-turns.router'
import { ThreadsRouter } from './platform/sessions/threads.router'

const READ_THROTTLE = { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttlMs: 60_000 }

const readProcedures = [
  ...(
    [
      'create',
      'open',
      'recent',
      'list',
      'get',
      'spawned',
      'rename',
      'archive',
      'chooseModel',
      'adopt',
      'rewind',
      'compact',
      'summarise',
      'fork',
    ] as const
  ).map((name) => ({ label: `threads.${name}`, handler: ThreadsRouter.prototype[name] })),
  ...(['append', 'replace', 'import', 'head'] as const).map((name) => ({
    label: `threadEvents.${name}`,
    handler: ThreadEventsRouter.prototype[name],
  })),
  ...(['record', 'tree', 'list'] as const).map((name) => ({
    label: `threadTurns.${name}`,
    handler: ThreadTurnsRouter.prototype[name],
  })),
]

describe('the first-party read routes', () => {
  for (const { label, handler } of readProcedures) {
    it(`raises the throttle on ${label} above the app-wide default`, () => {
      expect(procedureMetaOf(handler).throttle).toEqual(READ_THROTTLE)
    })
  }

  it('raises the throttle on SandboxesController above the app-wide default', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', SandboxesController)).toBe(
      CLIENT_READ_LIMIT_PER_MINUTE,
    )
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', SandboxesController)).toBe(60_000)
  })
})

describe('the serve-facing control-plane routes', () => {
  it(`skips the app-wide throttle on ${ProjectWorkspaceController.name}`, () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', ProjectWorkspaceController)).toBe(true)
  })

  it('skips the app-wide throttle on the events-read procedure serve polls mid-turn', () => {
    expect(procedureMetaOf(ThreadEventsRouter.prototype.read).throttle).toBe(false)
  })

  it('leaves the append and replace procedures throttled', () => {
    expect(procedureMetaOf(ThreadEventsRouter.prototype.append).throttle).not.toBe(false)
    expect(procedureMetaOf(ThreadEventsRouter.prototype.replace).throttle).not.toBe(false)
  })
})

describe('sandbox reachability of the thread procedures', () => {
  it('lets a sandbox token reach only create and open without naming a thread', () => {
    expect(procedureMetaOf(ThreadsRouter.prototype.create).sandboxReachable).toBe(true)
    expect(procedureMetaOf(ThreadsRouter.prototype.open).sandboxReachable).toBe(true)
    expect(procedureMetaOf(ThreadsRouter.prototype.list).sandboxReachable).toBeUndefined()
    expect(procedureMetaOf(ThreadsRouter.prototype.recent).sandboxReachable).toBeUndefined()
  })
})
