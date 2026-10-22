import { db, type Row } from '@dltech/atlas-db'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import { vi } from 'bun:test'

import { EnvService } from '../src/_core/config/env/env.service'
import { BackgroundWork } from '../src/_core/ports/background-work'
import { SandboxCredentials, type ThreadSandboxCredentials } from '../src/_core/ports/sandbox-credentials'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import {
  GithubSandboxWakeService,
  WAKE_DEBOUNCE_MS,
  type SandboxWakeBoot,
  type WakeBootArgs,
} from '../src/api/cloud/github/github-sandbox-wake.service'
import { seedCloudSandbox, seedSubscription as seedSubscriptionRow } from './github-seed'

export const SECRETS_KEY = 'a'.repeat(64)

export const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? SECRETS_KEY : undefined),
} as unknown as EnvService)

export const releaseArtifactCheck = (ok: boolean) =>
  vi.fn(async () => new Response(null, { status: ok ? 200 : 404 })) as unknown as typeof fetch

export const pastDate = (ms: number): Date => new Date(Date.now() - ms)

export const PR_EVENT = { userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 } as const

export const STORED_HASH = 'stored-hash'

export async function seedSubscription(args: { threadId?: string | null } = {}): Promise<void> {
  const threadId = args.threadId === undefined ? 'thr-1' : args.threadId
  await seedSubscriptionRow({
    userId: 'usr-1',
    branch: `#42-${threadId ?? 'none'}`,
    expiresAt: pastDate(60_000),
    liveUntil: pastDate(60_000),
    threadId,
  })
}

export function mirroredRecord(args: {
  threadId?: string
  phase: ERuntimePhase
  revision?: number
  reportedAt?: string
}): RuntimeCheckpoint {
  return {
    threadId: args.threadId ?? 'thr-1',
    runtimeId: 'runtime-1',
    sandboxSessionId: 'ses-1',
    revision: args.revision ?? 4,
    reportedAt: args.reportedAt ?? pastDate(120_000).toISOString(),
    transcript: { head: 3, count: 3, digest: 'c'.repeat(64) },
    phase: args.phase,
  } as RuntimeCheckpoint
}

export async function seedParkedSandbox(
  partial: Partial<Omit<Row<'CloudSandbox'>, 'runtimeCheckpoint'>> & { runtimeCheckpoint?: unknown } = {},
): Promise<void> {
  const threadId = partial.threadId ?? 'thr-1'
  const record = mirroredRecord({ threadId, phase: ERuntimePhase.Parked })
  await seedCloudSandbox({
    id: `sbx-${threadId}`,
    userId: 'usr-1',
    sandboxId: 'vsbx-1',
    name: 'atlas-sandbox-abc',
    region: 'iad1',
    state: 'parked',
    lastActivityAt: pastDate(60_000),
    tokenHash: STORED_HASH,
    sealedToken: cipher.encrypt('stored-token'),
    runtimeCheckpoint: record,
    runtimeCheckpointRevision: record.revision,
    ...partial,
    threadId,
  })
}

export const readSandbox = async (): Promise<Row<'CloudSandbox'>> => {
  const held = await db.orm.public.CloudSandbox.first()
  if (held === null) throw new Error('no seeded sandbox row')
  return held
}

export async function patchSandbox(
  patch: Partial<Omit<Row<'CloudSandbox'>, 'runtimeCheckpoint'>> & { runtimeCheckpoint?: unknown },
): Promise<void> {
  const { runtimeCheckpoint, ...columns } = patch
  const held = await readSandbox()
  await db.orm.public.CloudSandbox.where({ threadId: held.threadId }).update({
    ...columns,
    ...(runtimeCheckpoint === undefined
      ? {}
      : { runtimeCheckpoint: JSON.parse(JSON.stringify(runtimeCheckpoint)) }),
  })
}

export class RecordingBackgroundWork extends BackgroundWork {
  readonly kept: Promise<unknown>[] = []

  keepAlive(work: Promise<unknown>): void {
    this.kept.push(work)
  }

  async drain(): Promise<void> {
    for (let index = 0; index < this.kept.length; index += 1) await this.kept[index]
  }
}

let current: RecordingBackgroundWork = new RecordingBackgroundWork()

export function serviceWith(args: {
  boot: SandboxWakeBoot
  background?: BackgroundWork
  debounceMs?: number
  credentials?: Partial<ThreadSandboxCredentials>
}): GithubSandboxWakeService {
  const credentials: SandboxCredentials = {
    forThread: async () => ({
      token: 'vercel-token',
      teamId: 'team-1',
      projectId: 'proj-1',
      workspaceOwned: false,
      ...args.credentials,
    }),
  }
  const env = {
    get: (key: string) =>
      ({
        SANDBOX_IMAGE: 'atlas-sandbox:latest',
        ATLAS_CLOUD_URL: 'https://api.byatlas.io',
      })[key],
  } as unknown as EnvService
  const background = args.background ?? new RecordingBackgroundWork()
  if (background instanceof RecordingBackgroundWork) current = background
  return new GithubSandboxWakeService(
    env,
    cipher,
    credentials,
    args.boot,
    background,
    args.debounceMs ?? WAKE_DEBOUNCE_MS,
  )
}

export function fakeBoot(options: { created?: boolean; held?: Promise<void> } = {}): {
  boot: SandboxWakeBoot
  calls: WakeBootArgs[]
  entered: Promise<void>
} {
  const calls: WakeBootArgs[] = []
  let markEntered: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  return {
    calls,
    entered,
    boot: {
      boot: async (bootArgs: WakeBootArgs) => {
        calls.push(bootArgs)
        markEntered()
        await options.held
        const created = options.created ?? false
        if (created) await bootArgs.onFreshSandbox()
        return { serveUrl: 'https://serve.example.test', created }
      },
    },
  }
}

export const failingBoot = (): SandboxWakeBoot => ({
  boot: async () => {
    throw new Error('vercel is down')
  },
})

export async function settleLookups(): Promise<void> {
  await Promise.all(current.kept)
}

export async function advanceDebounce(): Promise<void> {
  await settleLookups()
  await vi.advanceTimersByTimeAsync(WAKE_DEBOUNCE_MS + 1)
}

export async function flushDebounce(): Promise<void> {
  await advanceDebounce()
  await current.drain()
}
