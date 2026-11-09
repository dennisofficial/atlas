import { describe, expect, it } from 'bun:test'

import { eventBodySchema } from '../schema'

describe('service-started event schema', () => {
  it('preserves the declared name, port, url and declaration hash', () => {
    const parsed = eventBodySchema.parse({
      type: 'service-started',
      serviceId: 'svc_1',
      name: 'web',
      port: 24_000,
      url: 'https://six-words.trycloudflare.com',
      declarationHash: 'abc12345',
      command: 'bun dev',
    })
    expect(parsed).toMatchObject({
      name: 'web',
      port: 24_000,
      url: 'https://six-words.trycloudflare.com',
      declarationHash: 'abc12345',
    })
  })

  it('still parses an undeclared service without them', () => {
    const parsed = eventBodySchema.parse({
      type: 'service-started',
      serviceId: 'svc_1',
      command: 'bun dev',
    })
    expect(parsed).not.toHaveProperty('name')
    expect(parsed).not.toHaveProperty('url')
  })
})
