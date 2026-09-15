import type { ExecutionContext } from '@nestjs/common'
import { HttpException, InternalServerErrorException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { MIN_CLIENT_VERSION_KEY } from '../../_core/decorators/min-client-version.decorator'
import { ClientVersionGuard } from './client-version.guard'

function contextFor(headers: Record<string, string>, minimum?: string): ExecutionContext {
  const handler = () => undefined
  if (minimum !== undefined) Reflect.defineMetadata(MIN_CLIENT_VERSION_KEY, minimum, handler)
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

function catchThrown(thunk: () => unknown): unknown {
  try {
    thunk()
    return null
  } catch (caught) {
    return caught
  }
}

describe('ClientVersionGuard', () => {
  it('allows undecorated routes regardless of the header', () => {
    const guard = new ClientVersionGuard(new Reflector())
    expect(guard.canActivate(contextFor({ 'atlas-client-version': '0.0.1' }))).toBe(true)
  })

  it('rejects a below-minimum client with 426 and the update body', () => {
    const guard = new ClientVersionGuard(new Reflector())
    const error = catchThrown(() =>
      guard.canActivate(contextFor({ 'atlas-client-version': '1.3.9' }, '1.4.0')),
    )
    expect(error).toBeInstanceOf(HttpException)
    if (!(error instanceof HttpException)) return
    expect(error.getStatus()).toBe(426)
    expect(error.getResponse()).toEqual({
      code: 'client-update-required',
      message: 'update Atlas to continue — this needs at least v1.4.0',
      minimum: '1.4.0',
      received: '1.3.9',
    })
  })

  it('allows a client at the minimum', () => {
    const guard = new ClientVersionGuard(new Reflector())
    expect(guard.canActivate(contextFor({ 'atlas-client-version': '1.4.0' }, '1.4.0'))).toBe(true)
  })

  it('allows a client newer than the minimum', () => {
    const guard = new ClientVersionGuard(new Reflector())
    expect(guard.canActivate(contextFor({ 'atlas-client-version': '2.0.0' }, '1.4.0'))).toBe(true)
  })

  it('allows a request without the header', () => {
    const guard = new ClientVersionGuard(new Reflector())
    expect(guard.canActivate(contextFor({}, '1.4.0'))).toBe(true)
  })

  it('allows a request whose header does not parse', () => {
    const guard = new ClientVersionGuard(new Reflector())
    expect(
      guard.canActivate(contextFor({ 'atlas-client-version': 'dev+20260914-abc123' }, '1.4.0')),
    ).toBe(true)
  })

  it('throws InternalServerErrorException when the decorator minimum does not parse', () => {
    const guard = new ClientVersionGuard(new Reflector())
    expect(() =>
      guard.canActivate(contextFor({ 'atlas-client-version': '9.9.9' }, 'banana')),
    ).toThrow(InternalServerErrorException)
  })
})
