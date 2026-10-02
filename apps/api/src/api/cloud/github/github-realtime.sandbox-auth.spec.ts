import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'
import { SANDBOX_REACHABLE_KEY } from '../../../_core/decorators/sandbox-reachable.decorator'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { GithubPrStreamController } from './github-pr-stream.controller'
import { GithubSubscriptionsController } from './github-subscriptions.controller'

describe('github realtime routes admit the sandbox token', () => {
  it.each([GithubSubscriptionsController, GithubPrStreamController])(
    '$name is sandbox-guarded and sandbox-reachable',
    (controller) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]
      expect(guards).toContain(SessionOrSandboxGuard)
      expect(Reflect.getMetadata(SANDBOX_REACHABLE_KEY, controller)).toBe(true)
    },
  )
})
