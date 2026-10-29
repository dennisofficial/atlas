import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FORBIDDEN_POD_ENV_KEYS,
  POD_ENV_API_PROVISIONED_KEYS,
  POD_ENV_IDENTITY_KEYS,
  POD_ENV_VERCEL_CREDENTIAL_KEYS,
  POD_TELEMETRY_IDENTITY_ENV,
} from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { runPodProvision } from './pod-provision-run'
import {
  fakeBoot,
  runDepsWith,
  sandboxRows,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'

const SANDBOX_MOUNT_SOURCE = join(
  import.meta.dirname,
  '../../../../../../packages/wire/src/sandbox-mount.ts',
)

const mountEnvKeys = (): string[] => {
  const source = readFileSync(SANDBOX_MOUNT_SOURCE, 'utf8')
  const block = /env: \{([\s\S]*?)\n {8}\},/.exec(source)?.[1] ?? ''
  return [...block.matchAll(/\b((?:ATLAS|VERCEL)_[A-Z_]+):/g)].map((match) => match[1] ?? '')
}

describe('API pod env contract', () => {
  useTestDatabase()

  it('provisions with only contract-listed env keys', async () => {
    await seedThread()
    await seedSandboxRow()
    const [row] = await sandboxRows()
    const { boot, calls } = fakeBoot()

    await runPodProvision({
      payload: { threadId: 'thr-1', wakeClaim: row?.wakeClaim?.toISOString() ?? '' },
      deps: runDepsWith({ boot, telemetryPepper: 'p' }),
    })

    const keys = Object.keys(calls[0]?.environment ?? {})
    const allowed = [...POD_ENV_API_PROVISIONED_KEYS, POD_TELEMETRY_IDENTITY_ENV]
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => !allowed.includes(key))).toEqual([])
    expect(keys.filter((key) => FORBIDDEN_POD_ENV_KEYS.includes(key))).toEqual([])
  })

  it('the shared mount layer injects only contract-listed keys', () => {
    const keys = mountEnvKeys()
    const allowed = [
      ...POD_ENV_IDENTITY_KEYS,
      ...POD_ENV_API_PROVISIONED_KEYS,
      ...POD_ENV_VERCEL_CREDENTIAL_KEYS,
    ]

    expect(keys).toContain('ATLAS_SERVE_TOKEN')
    expect(keys.filter((key) => !allowed.includes(key))).toEqual([])
    expect(keys.filter((key) => FORBIDDEN_POD_ENV_KEYS.includes(key))).toEqual([])
  })
})
