import { EBootStep, EBootStepState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { seedThread as seedThreadRow, seedUser } from '@dltech/atlas-db/testing'
import { vi } from 'vitest'
import type { Sandbox } from '@vercel/sandbox'
import type { EnvService } from '../../../_core/config/env/env.service'
import { ProcessBackgroundWork } from '../../../_lib/background-work/background-work.providers'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { SandboxWakeBoot, WakeBootArgs } from '../github/github-sandbox-wake-boot'
import type { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { SandboxProvisioningService } from './sandbox-provisioning.service'
import type { ServeSendArgs } from './serve-send'
import { ThreadMessagesService } from './thread-messages.service'

export const CREDENTIALS = { token: 'ws-token', teamId: 'team-ws', projectId: 'vcl-proj' }

const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? 'b'.repeat(64) : undefined),
} as unknown as EnvService)

export async function seedThread(partial: { projectId?: string | null; modelRef?: string | null } = {}): Promise<void> {
  await seedUser({ db, id: 'usr-1' })
  for (const id of ['prj-1', 'prj-9']) {
    await db.orm.public.Project.create({ id, name: id, ownerUserId: 'usr-1', createdById: 'usr-1' })
  }
  const projectId = partial.projectId === undefined ? 'prj-1' : partial.projectId
  await seedThreadRow({ db, id: 'thr-1', userId: 'usr-1', ...(projectId === null ? {} : { projectId }) })
  if (partial.modelRef !== undefined && partial.modelRef !== null) {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ modelRef: partial.modelRef })
  }
}

export const sandboxRows = () => db.orm.public.CloudSandbox.all()

export const threadRow = () => db.orm.public.Thread.first({ id: 'thr-1' })

export const bootEvents = () => db.orm.public.Event.where({ type: 'sandbox-boot-step' }).all()

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

export function fakeScoped(overrides: Partial<Record<'vercelCredentials' | 'accessibleProject', unknown>> = {}) {
  const scoped = {
    vercelCredentials: vi.fn(async () => CREDENTIALS),
    accessibleProject: vi.fn(async () => ({ id: 'prj-9', organizationId: 'org-1' })),
    ...overrides,
  }
  return scoped as unknown as ScopedConfigService & typeof scoped
}

export function serviceWith(args: {
  boot: SandboxWakeBoot
  scoped?: ScopedConfigService
  messages?: ThreadMessagesService
}) {
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
    args.messages ?? messagesWith({}).service,
  )
}

export function fakeSandbox() {
  const runCommand = vi.fn(async () => ({}))
  const writeFiles = vi.fn(async () => undefined)
  return { sandbox: { runCommand, writeFiles } as unknown as Sandbox, runCommand, writeFiles }
}

export function messagesWith(args: { endpoint?: { token: string; url: string } | null; serveFails?: Error }) {
  const endpoint = args.endpoint ?? null
  const runningEndpoint = vi.fn(async () => endpoint)
  const serve = vi.fn(async (_delivery: ServeSendArgs) => {
    if (args.serveFails !== undefined) throw args.serveFails
  })
  const service = new ThreadMessagesService({ runningEndpoint } as unknown as SandboxEndpointService, serve)
  return { service, serve, runningEndpoint }
}
