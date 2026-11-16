import { describe, expect, it } from 'bun:test'

import { trpcData } from '../../cloud/__tests__/trpc-wire'
import { ArtifactNotFound } from '../artifact-port'
import { failure, failureOf, portWith } from './cloud-artifact-port-rig'

describe('CloudArtifactPort build status', () => {
  it('reads the build status of one version', async () => {
    const status = {
      subdomain: 'demo',
      version: 3,
      url: 'https://demo.artifacts.test',
      outcome: 'ready' as const,
      failure: null,
      log: null,
      durationMs: 41_000,
      supersededBy: null,
    }
    const { port, calls } = portWith({ respond: () => trpcData(status) })

    expect(await port.buildStatus({ subdomain: 'demo', version: 3 })).toEqual(status)
    expect(calls[0]?.procedure).toBe('artifacts.buildStatus')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.input).toEqual({ subdomain: 'demo', version: 3 })
  })

  it('maps a 404 on a build status to ArtifactNotFound, so a vanished artifact is told apart', async () => {
    const { port } = portWith({
      respond: () => failure({ status: 404, trpcCode: 'NOT_FOUND', message: 'no artifact demo' }),
    })

    expect(await failureOf(port.buildStatus({ subdomain: 'demo', version: 3 }))).toBeInstanceOf(
      ArtifactNotFound,
    )
  })

  it('names the procedure when a build status is not an artifact answer', async () => {
    const { port } = portWith({ respond: () => trpcData({ nope: true }) })

    const error = await failureOf(port.buildStatus({ subdomain: 'demo', version: 3 }))

    expect((error as Error).message).toContain('artifacts.buildStatus')
  })
})
