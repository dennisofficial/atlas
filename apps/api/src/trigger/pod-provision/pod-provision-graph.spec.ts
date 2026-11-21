import { describe, expect, it } from 'bun:test'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { EnvService } from '../../_core/config/env/env.service'
import { buildPodProvisionDeps, flushQuietly } from './pod-provision-graph'

const flushed = (flush: () => Promise<void>): ProductAnalytics =>
  ({ capture: () => undefined, flush }) as unknown as ProductAnalytics

describe('buildPodProvisionDeps', () => {
  it('builds the run dependencies by hand from the worker env', () => {
    const env = new EnvService({
      SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      SANDBOX_IMAGE: 'atlas-sandbox:test',
    })

    const deps = buildPodProvisionDeps({ env })

    expect(deps).toMatchObject({ image: 'atlas-sandbox:test', cloudUrl: 'https://api.byatlas.io' })
    expect(typeof deps.boot.boot).toBe('function')
  })

  it('hands the provision run a tracer only when the thread is known', () => {
    const env = new EnvService({
      SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      SANDBOX_IMAGE: 'atlas-sandbox:test',
    })

    expect(buildPodProvisionDeps({ env, threadId: 'thr-1' }).trace).toBeDefined()
    expect(buildPodProvisionDeps({ env }).trace).toBeUndefined()
  })
})

describe('flushQuietly', () => {
  it('swallows a failed trace flush so it cannot fail the provision task', async () => {
    await expect(
      flushQuietly(
        flushed(async () => {
          throw new Error('posthog unreachable')
        }),
      ),
    ).resolves.toBeUndefined()
  })

  it('swallows a flush that throws before it returns a promise', async () => {
    await expect(
      flushQuietly(
        flushed(() => {
          throw new Error('client closed')
        }),
      ),
    ).resolves.toBeUndefined()
  })

  it('tolerates a graph with no tracer to flush', async () => {
    await expect(flushQuietly(undefined)).resolves.toBeUndefined()
  })
})
