import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { serviceIdFor } from '../daemon'

const ctxOf = (
  callId: string | undefined,
): Pick<PluginPodContext, 'sessionId'> & {
  toolCallId?: () => string | undefined
} => ({
  sessionId: 's1',
  ...(callId === undefined ? {} : { toolCallId: () => callId }),
})

describe('serviceIdFor', () => {
  it('names the same service the same way each time a call is replayed', () => {
    const identity = 'web'
    expect(serviceIdFor({ ctx: ctxOf('call-1'), identity })).toBe(
      serviceIdFor({ ctx: ctxOf('call-1'), identity }),
    )
  })

  it('separates two services of one call and one service of two calls', () => {
    const first = serviceIdFor({ ctx: ctxOf('call-1'), identity: 'web' })
    const second = serviceIdFor({ ctx: ctxOf('call-1'), identity: 'api' })
    const other = serviceIdFor({ ctx: ctxOf('call-2'), identity: 'web' })
    expect(new Set([first, second, other]).size).toBe(3)
    expect(first).toMatch(/^svc-[0-9a-f]{8}$/)
  })

  it('falls back to a fresh id outside a tool call', () => {
    expect(serviceIdFor({ ctx: ctxOf(undefined), identity: 'web' })).toMatch(/^svc-[0-9a-f-]{8}$/)
  })
})
