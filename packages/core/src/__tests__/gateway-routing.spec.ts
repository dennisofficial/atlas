import { describe, expect, it } from 'bun:test'

import { gatewayRoutingOf, readGatewayRouting } from '../provider'

describe('readGatewayRouting', () => {
  it('reads the provider and session source the gateway reports', () => {
    expect(
      readGatewayRouting({
        gateway: { routing: { finalProvider: 'baseten', sessionIdSource: 'explicit' } },
      }),
    ).toEqual({ finalProvider: 'baseten', sessionIdSource: 'explicit' })
  })

  it('keeps whichever half the gateway sent', () => {
    expect(readGatewayRouting({ gateway: { routing: { finalProvider: 'baseten' } } })).toEqual({
      finalProvider: 'baseten',
      sessionIdSource: undefined,
    })
  })

  it('reports nothing when a provider publishes no routing', () => {
    expect(readGatewayRouting(undefined)).toBeUndefined()
    expect(readGatewayRouting({ anthropic: { cacheCreationInputTokens: 4 } })).toBeUndefined()
    expect(readGatewayRouting({ gateway: {} })).toBeUndefined()
  })
})

describe('gatewayRoutingOf', () => {
  it('reads routing off a settled step', async () => {
    const step = Promise.resolve({
      providerMetadata: { gateway: { routing: { finalProvider: 'baseten' } } },
    })

    expect(await gatewayRoutingOf(step)).toMatchObject({ finalProvider: 'baseten' })
  })

  it('answers nothing when the step never settles', async () => {
    expect(await gatewayRoutingOf(Promise.reject(new Error('aborted')))).toBeUndefined()
  })
})
