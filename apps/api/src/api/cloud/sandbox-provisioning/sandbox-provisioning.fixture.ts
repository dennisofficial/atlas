import { EBootStep, EBootStepState } from '@dltech/atlas-wire'
import { vi } from 'vitest'
import type { Sandbox } from '@vercel/sandbox'
import type { EnvService } from '../../../_core/config/env/env.service'
import { ProcessBackgroundWork } from '../../../_lib/background-work/background-work.providers'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { provisioningFakeDb } from '../../../../test/sandbox-provisioning-fake-db'
import type { SandboxWakeBoot, WakeBootArgs } from '../github/github-sandbox-wake-boot'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { SandboxProvisioningService } from './sandbox-provisioning.service'

export const fake = provisioningFakeDb()

export const CREDENTIALS = { token: 'ws-token', teamId: 'team-ws', projectId: 'vcl-proj' }

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? 'b'.repeat(64) : undefined),
} as unknown as EnvService)

export function seedThread(
  partial: { projectId?: string | null; modelRef?: string | null } = {},
): void {
  fake.threads.push({
    id: 'thr-1',
    userId: 'usr-1',
    head: 0,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    modelRef: partial.modelRef ?? null,
    executionLocation: null,
    projectId: partial.projectId === undefined ? 'prj-1' : partial.projectId,
  })
}

export function fakeBoot(options: { held?: Promise<void>; failWith?: Error } = {}): {
  boot: SandboxWakeBoot
  calls: WakeBootArgs[]
} {
  const calls: WakeBootArgs[] = []
  return {
    calls,
    boot: {
      boot: async (args) => {
        calls.push(args)
        await options.held
        if (options.failWith !== undefined) {
          await args.reporter?.report({
            step: EBootStep.Provision,
            state: EBootStepState.Error,
            error: options.failWith.message,
          })
          throw options.failWith
        }
        return { serveUrl: 'https://serve.example.test', created: true }
      },
    },
  }
}

export function fakeScoped(
  overrides: Partial<Record<'vercelCredentials' | 'accessibleProject', unknown>> = {},
) {
  const scoped = {
    vercelCredentials: vi.fn(async () => CREDENTIALS),
    accessibleProject: vi.fn(async () => ({ id: 'prj-9', organizationId: 'org-1' })),
    ...overrides,
  }
  return scoped as unknown as ScopedConfigService & typeof scoped
}

export function serviceWith(args: { boot: SandboxWakeBoot; scoped?: ScopedConfigService }) {
  const env = {
    get: (key: string) =>
      ({ SANDBOX_IMAGE: 'atlas-sandbox:latest', ATLAS_CLOUD_URL: 'https://api.byatlas.io' })[key],
  } as unknown as EnvService
  return new SandboxProvisioningService(
    args.scoped ?? fakeScoped(),
    env,
    cipher,
    args.boot,
    new ProcessBackgroundWork(),
  )
}

export function fakeSandbox() {
  const runCommand = vi.fn(async () => ({}))
  const writeFiles = vi.fn(async () => undefined)
  return { sandbox: { runCommand, writeFiles } as unknown as Sandbox, runCommand, writeFiles }
}
