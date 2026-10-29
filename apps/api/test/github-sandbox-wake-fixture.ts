import { db, type Row } from '@dltech/atlas-db'
import { seedThread } from '@dltech/atlas-db/testing'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import { vi } from 'bun:test'

import { EnvService } from '../src/_core/config/env/env.service'
import { BackgroundWork } from '../src/_core/ports/background-work'
import {
  SandboxCredentials,
  type ThreadSandboxCredentials,
} from '../src/_core/ports/sandbox-credentials'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import {
  GithubSandboxWakeService,
  WAKE_DEBOUNCE_MS,
  type SandboxWakeBoot,
  type WakeBootArgs,
} from '../src/api/cloud/github/github-sandbox-wake.service'
import { GithubPrFanoutService } from '../src/api/cloud/github/github-pr-fanout.service'
import { DrainStateService } from '../src/api/platform/health/drain-state.service'
import { inertSignals } from '../src/api/platform/sessions/thread-signals.fixture'
import { seedCloudSandbox, seedSubscription as seedSubscriptionRow } from './github-seed'
import { advanceTimersByTimeAsync } from './fake-timers'

export const SECRETS_KEY = 'a'.repeat(64)

export const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? SECRETS_KEY : undefined),
} as unknown as EnvService)

export const releaseArtifactCheck = (ok: boolean) =>
  vi.fn(async () => new Response(null, { status: ok ? 200 : 404 })) as unknown as typeof fetch

export const pastDate = (ms: number): Date => new Date(Date.now() - ms)

export const PR_EVENT = { userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 } as const

export const STORED_HASH = 'stored-hash'

export enum ESeededSubscription {
  Active = 'active',
  Paused = 'paused',
  Absent = 'absent',
}

export async function seedThreadSubscription(args: {
  threadId: string
  status: ESeededSubscription
  target?: unknown
}): Promise<void> {
  if (args.status === ESeededSubscription.Absent) return
  if ((await db.orm.public.Thread.first({ id: args.threadId })) === null) {
    await seedThread({ db, id: args.threadId, userId: 'usr-1' })
  }
  const target = args.target ?? { repo: 'github.com/compai/app', number: 42 }
  const bodies: Record<string, unknown>[] = [
    {
      type: 'subscription-created',
      subscriptionId: 'sub-1',
      provider: 'github.pull-request',
      target,
      label: 'compai/app#42',
      createdBy: 'agent',
    },
    ...(args.status === ESeededSubscription.Paused
      ? [
          {
            type: 'subscription-changed',
            subscriptionId: 'sub-1',
            status: 'paused',
            by: 'operator',
          },
        ]
      : []),
  ]
  for (const [index, body] of bodies.entries()) {
    await seedEvent({ threadId: args.threadId, seq: index + 1, type: String(body.type), body })
  }
}

async function seedEvent(args: {
  threadId: string
  seq: number
  type: string
  body: Record<string, unknown>
}): Promise<void> {
  await db.orm.public.Event.create({
    id: `evt_${args.threadId}_${args.seq}`,
    threadId: args.threadId,
    seq: args.seq,
    runId: 'run_1',
    depth: 0,
    at: new Date(),
    type: args.type,
    body: JSON.stringify(args.body),
    userId: 'usr-1',
  })
}

export async function seedSubscription(
  args: { threadId?: string | null; subscription?: ESeededSubscription; target?: unknown } = {},
): Promise<void> {
  const threadId = args.threadId === undefined ? 'thr-1' : args.threadId
  await seedSubscriptionRow({
    userId: 'usr-1',
    branch: `#42-${threadId ?? 'none'}`,
    expiresAt: pastDate(60_000),
    liveUntil: pastDate(60_000),
    threadId,
  })
  if (threadId === null) return
  await seedThreadSubscription({
    threadId,
    status: args.subscription ?? ESeededSubscription.Active,
    ...(args.target === undefined ? {} : { target: args.target }),
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
  partial: Partial<Omit<Row<'CloudSandbox'>, 'runtimeCheckpoint'>> & {
    threadId?: string
    runtimeCheckpoint?: unknown
  } = {},
): Promise<void> {
  const { threadId: ownThread, ...columns } = partial
  const threadId = ownThread ?? 'thr-1'
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
    ...columns,
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
  await db.orm.public.CloudSandbox.where({ sessionId: held.sessionId }).update({
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

export const WAKE_PEPPER = 'wake-pepper'

export function serviceWith(args: {
  boot: SandboxWakeBoot
  background?: BackgroundWork
  debounceMs?: number
  credentials?: Partial<ThreadSandboxCredentials>
  fanout?: GithubPrFanoutService
}): GithubSandboxWakeService {
  const credentials: SandboxCredentials = {
    forThread: async () => ({
      token: 'vercel-token',
      teamId: 'team-1',
      projectId: 'proj-1',
      ownerCredential: false,
      userId: undefined,
      ...args.credentials,
    }),
  }
  const env = {
    get: (key: string) =>
      ({
        SANDBOX_IMAGE: 'atlas-sandbox:latest',
        ATLAS_CLOUD_URL: 'https://api.byatlas.io',
        ATLAS_TELEMETRY_PEPPER: WAKE_PEPPER,
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
    inertSignals(),
    args.fanout ?? new GithubPrFanoutService(new DrainStateService()),
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
  await advanceTimersByTimeAsync(WAKE_DEBOUNCE_MS + 1)
}

export async function flushDebounce(): Promise<void> {
  await advanceDebounce()
  await current.drain()
}
