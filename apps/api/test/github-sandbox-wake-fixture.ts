import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import { vi } from 'vitest'

import { EnvService } from '../src/_core/config/env/env.service'
import { BackgroundWork } from '../src/_core/ports/background-work'
import { ProcessBackgroundWork } from '../src/_lib/background-work/background-work.providers'
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
import { fakeGithubDb, seedCloudSandbox, type FakeCloudSandboxRow } from './fake-github-db'

export const fake = fakeGithubDb()

export const SECRETS_KEY = 'a'.repeat(64)

export const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? SECRETS_KEY : undefined),
} as unknown as EnvService)

export const releaseArtifactCheck = (ok: boolean) =>
  vi.fn(async () => new Response(null, { status: ok ? 200 : 404 })) as unknown as typeof fetch

export const pastIso = (ms: number): string => new Date(Date.now() - ms).toISOString()

export const PR_EVENT = { userId: 'usr-1', repoFullName: 'compai/app', prNumber: 42 } as const

export function seedSubscription(args: { threadId?: string | null } = {}): void {
  fake.subscriptions.push({
    id: `sub-${fake.subscriptions.length + 1}`,
    userId: 'usr-1',
    repoFullName: 'compai/app',
    prNumber: 42,
    branch: '',
    pollBacked: false,
    expiresAt: new Date(Date.now() - 60_000),
    liveUntil: new Date(Date.now() - 60_000),
    threadId: args.threadId === undefined ? 'thr-1' : args.threadId,
    sandboxId: null,
    createdAt: new Date(),
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
    reportedAt: args.reportedAt ?? pastIso(120_000),
    transcript: { head: 3, count: 3, digest: 'c'.repeat(64) },
    phase: args.phase,
  } as RuntimeCheckpoint
}

export function seedParkedSandbox(partial: Partial<FakeCloudSandboxRow> = {}): void {
  const record = mirroredRecord({
    threadId: partial.threadId ?? 'thr-1',
    phase: ERuntimePhase.Parked,
  })
  seedCloudSandbox({
    id: `sbx-${partial.threadId ?? 'thr-1'}`,
    threadId: 'thr-1',
    userId: 'usr-1',
    sandboxId: 'vsbx-1',
    name: 'atlas-sandbox-abc',
    region: 'iad1',
    state: 'parked',
    lastActivityAt: pastIso(60_000),
    tokenHash: 'stored-hash',
    sealedToken: cipher.encrypt('stored-token'),
    runtimeCheckpoint: record,
    runtimeCheckpointRevision: record.revision,
    ...partial,
  })
}

export class RecordingBackgroundWork extends BackgroundWork {
  readonly kept: Promise<unknown>[] = []

  keepAlive(work: Promise<unknown>): void {
    this.kept.push(work)
  }
}

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
  return new GithubSandboxWakeService(
    env,
    cipher,
    credentials,
    args.boot,
    args.background ?? new ProcessBackgroundWork(),
    args.debounceMs ?? WAKE_DEBOUNCE_MS,
  )
}

export function fakeBoot(options: { created?: boolean; held?: Promise<void> } = {}): {
  boot: SandboxWakeBoot
  calls: WakeBootArgs[]
} {
  const calls: WakeBootArgs[] = []
  return {
    calls,
    boot: {
      boot: async (bootArgs: WakeBootArgs) => {
        calls.push(bootArgs)
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

export async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(WAKE_DEBOUNCE_MS + 1)
  await vi.advanceTimersByTimeAsync(0)
}
