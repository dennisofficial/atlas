import { describe, expect, it } from 'bun:test'

import { servicesLogInputSchema, servicesLogOutputSchema } from '../services'

describe('services schemas', () => {
  it('round-trips the log input and output', () => {
    const input = { sessionId: 'ses', serviceId: 'web' }
    expect(servicesLogInputSchema.parse(input)).toEqual(input)
    const output = { text: 'listening on :4321\n', truncated: false }
    expect(servicesLogOutputSchema.parse(output)).toEqual(output)
  })

  it('rejects an empty session or service id', () => {
    expect(servicesLogInputSchema.safeParse({ sessionId: '', serviceId: 'web' }).success).toBe(
      false,
    )
    expect(servicesLogInputSchema.safeParse({ sessionId: 'ses', serviceId: '' }).success).toBe(
      false,
    )
  })

  it('rejects unknown keys on the output', () => {
    expect(
      servicesLogOutputSchema.safeParse({ text: '', truncated: false, offset: 0 }).success,
    ).toBe(false)
  })
})
