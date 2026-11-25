import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { RetiredSandboxTokenMiddleware } from './retired-sandbox-token.middleware'

describe('RetiredSandboxTokenMiddleware', () => {
  it('refuses every caller, session or token', () => {
    expect(() => new RetiredSandboxTokenMiddleware().use()).toThrow(UnauthorizedException)
  })
})
