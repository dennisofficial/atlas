import { describe, expect, it } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'
import { buildPodProvisionDeps } from './pod-provision-graph'

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
})
