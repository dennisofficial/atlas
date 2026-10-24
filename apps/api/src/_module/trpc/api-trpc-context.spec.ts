import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'
import type { Request, Response } from 'express'
import { describe, expect, it } from 'bun:test'
import { ApiTrpcContext } from './api-trpc-context'

const optionsFor = (headers: Record<string, string>) => {
  const set = new Map<string, string>()
  const req = { headers } as unknown as Request
  const res = {
    setHeader: (name: string, value: string) => set.set(name.toLowerCase(), value),
  } as unknown as Response
  const options = { req, res, info: undefined } as unknown as CreateExpressContextOptions
  return { options, set }
}

describe('ApiTrpcContext', () => {
  it('marks every tRPC response no-store', () => {
    const { options, set } = optionsFor({})
    new ApiTrpcContext().create(options)
    expect(set.get('cache-control')).toBe('no-store')
  })

  it('reads the bearer token and client version', () => {
    const { options } = optionsFor({
      authorization: 'Bearer tok',
      'atlas-client-version': '1.2.3',
    })
    const ctx = new ApiTrpcContext().create(options)
    expect(ctx.bearerToken).toBe('tok')
    expect(ctx.clientVersion).toBe('1.2.3')
  })
})
