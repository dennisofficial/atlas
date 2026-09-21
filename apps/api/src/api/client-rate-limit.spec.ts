import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { CLIENT_READ_LIMIT_PER_MINUTE } from './client-rate-limit'
import { SandboxHeartbeatController } from './sandboxes/heartbeat.controller'
import { SandboxesController } from './sandboxes/sandboxes.controller'
import { ServeBinaryController } from './sandboxes/serve-binary.controller'
import { SandboxWorkspaceController } from './sandboxes/workspace.controller'
import { EventsController } from './sessions/events.controller'
import { ThreadsController } from './sessions/threads.controller'
import { TurnsController } from './sessions/turns.controller'

const readRoutes = [EventsController, ThreadsController, TurnsController, SandboxesController]

describe('the first-party read routes', () => {
  for (const controller of readRoutes) {
    it(`raises the throttle on ${controller.name} above the app-wide default`, () => {
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', controller)).toBe(
        CLIENT_READ_LIMIT_PER_MINUTE,
      )
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', controller)).toBe(60_000)
    })
  }
})

const serveFacingControllers = [
  SandboxHeartbeatController,
  SandboxWorkspaceController,
  ServeBinaryController,
]

describe('the serve-facing control-plane routes', () => {
  for (const controller of serveFacingControllers) {
    it(`skips the app-wide throttle on ${controller.name}`, () => {
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', controller)).toBe(true)
    })
  }

  it('skips the app-wide throttle on the events-read route serve polls mid-turn', () => {
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', EventsController.prototype.handleRead),
    ).toBe(true)
  })

  it('leaves the append and replace routes throttled', () => {
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', EventsController.prototype.handleAppend),
    ).toBeUndefined()
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', EventsController.prototype.handleReplace),
    ).toBeUndefined()
  })
})
