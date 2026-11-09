import { describe, expect, it } from 'bun:test'

import { waitForHealth } from '../port-probe'

const serve = (status: number) => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(status === 204 ? null : 'not yet', { status }),
  })
  return server
}

const portOf = (server: ReturnType<typeof serve>): number => {
  if (server.port === undefined) throw new Error('the server did not take a port')
  return server.port
}

describe('waitForHealth', () => {
  it('is ready once the health path answers 204', async () => {
    const server = serve(204)
    try {
      const healthy = await waitForHealth({
        port: portOf(server),
        path: '/healthz',
        timeoutMs: 2_000,
        cancelled: () => false,
      })
      expect(healthy).toBe(true)
    } finally {
      await server.stop(true)
    }
  })

  it('fails when the health path answers 500 until the deadline', async () => {
    const server = serve(500)
    try {
      const started = Date.now()
      const healthy = await waitForHealth({
        port: portOf(server),
        path: '/healthz',
        timeoutMs: 300,
        cancelled: () => false,
      })
      expect(healthy).toBe(false)
      expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    } finally {
      await server.stop(true)
    }
  })

  it('fails when the port answers nothing', async () => {
    const healthy = await waitForHealth({
      port: 1,
      path: '/healthz',
      timeoutMs: 200,
      cancelled: () => false,
    })
    expect(healthy).toBe(false)
  })
})
