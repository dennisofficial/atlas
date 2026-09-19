import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { CLIENT_READ_LIMIT_PER_MINUTE } from './client-rate-limit'
import { SandboxesController } from './sandboxes/sandboxes.controller'
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
