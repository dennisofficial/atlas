import { EBootStep, EBootStepState, ERuntimePhase, type VercelSdk } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { seedThread as seedThreadRow, seedUser } from '@dltech/atlas-db/testing'
import { vi } from 'bun:test'
import type { Sandbox } from '@vercel/sandbox'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { JobDispatch, JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import type { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { ThreadsService } from '../../platform/sessions/threads.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { appendWithin } from '../../platform/sessions/append'
import type { SandboxWakeBoot, WakeBootArgs } from '../github/github-sandbox-wake-boot'
import type { ScopedConfigService } from '../scoped-config/scoped-config.service'
import type { PodProvisionTask } from './pod-provision.contract'
import { fakeSdk } from './pod-provision.sdk.fixture'
import { PodLaunchService } from './pod-launch.service'
import { SandboxProvisioningService } from './sandbox-provisioning.service'
import type { ServeSendArgs } from './serve-send'
import type {
  ThreadTitlingService,
  TitleFirstMessage,
} from '../thread-titling/thread-titling.service'
import { ThreadLaunchService } from './thread-launch.service'
import { ThreadMessagesService } from './thread-messages.service'

export const CREDENTIALS = { token: 'ws-token', teamId: 'team-ws', projectId: 'vcl-proj' }

export const cipher = new SecretCipherService({
  get: (key: string) => (key === 'SECRETS_ENCRYPTION_KEY' ? 'b'.repeat(64) : undefined),
} as unknown as EnvService)

export async function seedBase(): Promise<void> {
  await seedUser({ db, id: 'usr-1' })
  for (const id of ['prj-1', 'prj-9']) {
    await db.orm.public.Project.create({ id, name: id, ownerUserId: 'usr-1', createdById: 'usr-1' })
  }
}

export async function seedThread(
  partial: { projectId?: string | null; modelRef?: string | null } = {},
): Promise<void> {
  await seedBase()
  const projectId = partial.projectId === undefined ? 'prj-1' : partial.projectId
  await seedThreadRow({
    db,
    id: 'thr-1',
    userId: 'usr-1',
    ...(projectId === null ? {} : { projectId }),
  })
  if (partial.modelRef !== undefined && partial.modelRef !== null) {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ modelRef: partial.modelRef })
  }
}

export const sandboxRows = () => db.orm.public.CloudSandbox.all()

export const threadRow = () => db.orm.public.Thread.first({ id: 'thr-1' })

export const bootSteps = (threadId = 'thr-1') =>
  db.orm.public.SandboxBootStep.where({ threadId })
    .orderBy((step) => step.at.asc())
    .all()

export const eventsOf = (threadId = 'thr-1') =>
  db.orm.public.Event.where({ threadId })
    .orderBy((event) => event.seq.asc())
    .all()

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
    accessibleProject: vi.fn(async () => 'prj-9'),
    ...overrides,
  }
  return scoped as unknown as ScopedConfigService & typeof scoped
}

export function fakeDispatcher(options: { failWith?: Error } = {}) {
  const dispatch = vi.fn(async (_job: JobDispatch<PodProvisionTask>) => {
    if (options.failWith !== undefined) throw options.failWith
    return { runId: 'run_fake' }
  })
  return { dispatcher: { dispatch } as unknown as JobDispatcher, dispatch }
}

export function podLaunchWith(
  args: {
    scoped?: ScopedConfigService
    dispatcher?: ReturnType<typeof fakeDispatcher>
    signals?: ThreadSignalsService
  } = {},
) {
  const dispatching = args.dispatcher ?? fakeDispatcher()
  const pod = new PodLaunchService(
    args.scoped ?? fakeScoped(),
    cipher,
    dispatching.dispatcher,
    args.signals ?? inertSignals(),
  )
  return { pod, dispatch: dispatching.dispatch }
}

export function provisioningWith(
  args: { scoped?: ScopedConfigService; dispatcher?: ReturnType<typeof fakeDispatcher> } = {},
) {
  const launched = podLaunchWith(args)
  return { service: new SandboxProvisioningService(launched.pod), dispatch: launched.dispatch }
}

export function launchWith(
  args: { scoped?: ScopedConfigService; dispatcher?: ReturnType<typeof fakeDispatcher> } = {},
) {
  const launched = podLaunchWith(args)
  const titleFirstMessage = vi.fn(async (_titling: TitleFirstMessage) => undefined)
  const keepAlive = vi.fn((_work: Promise<unknown>) => undefined)
  return {
    service: new ThreadLaunchService(
      new ThreadsService(inertSignals()),
      launched.pod,
      { keepAlive },
      { titleFirstMessage } as unknown as ThreadTitlingService,
    ),
    dispatch: launched.dispatch,
    titleFirstMessage,
    keepAlive,
  }
}

export function fakeSandbox() {
  const runCommand = vi.fn(async () => ({}))
  const writeFiles = vi.fn(async () => undefined)
  return { sandbox: { runCommand, writeFiles } as unknown as Sandbox, runCommand, writeFiles }
}

export function messagesWith(
  args: {
    endpoint?: { token: string; url: string } | null
    serveFails?: Error
    scoped?: ScopedConfigService
    dispatcher?: ReturnType<typeof fakeDispatcher>
    signals?: ThreadSignalsService
  } = {},
) {
  const signals = args.signals ?? inertSignals()
  const endpoint = args.endpoint ?? null
  const runningEndpoint = vi.fn(async () => endpoint)
  const serve = vi.fn(async (_delivery: ServeSendArgs) => {
    if (args.serveFails !== undefined) throw args.serveFails
  })
  const launched = podLaunchWith({
    signals,
    ...(args.scoped === undefined ? {} : { scoped: args.scoped }),
    ...(args.dispatcher === undefined ? {} : { dispatcher: args.dispatcher }),
  })
  const service = new ThreadMessagesService(
    { runningEndpoint } as unknown as SandboxEndpointService,
    serve,
    launched.pod,
    signals,
  )
  return { service, serve, runningEndpoint, dispatch: launched.dispatch }
}

export type SeededCheckpoint = {
  threadId: string
  runtimeId: string
  sandboxSessionId: string
  revision: number
  reportedAt: string
  transcript: { head: number; count: number; digest: string }
  phase: ERuntimePhase.Parking | ERuntimePhase.Parked
}

export async function seedSandboxRow(
  partial: {
    state?: string
    wakeClaim?: Date | null
    wakeFailedAt?: Date | null
    serveUrl?: string | null
    runtimeCheckpoint?: SeededCheckpoint
  } = {},
): Promise<void> {
  const at = new Date()
  await db.orm.public.CloudSandbox.create({
    id: 'sbx-1',
    threadId: 'thr-1',
    userId: 'usr-1',
    sandboxId: '',
    name: 'atlas-thread-1',
    region: 'iad1',
    state: partial.state ?? 'resuming',
    lastActivityAt: at,
    tokenHash: 'hash',
    sealedToken: cipher.encrypt('seed-token'),
    wakeClaim: partial.wakeClaim === undefined ? at : partial.wakeClaim,
    wakeFailedAt: partial.wakeFailedAt ?? null,
    serveUrl: partial.serveUrl ?? null,
    ...(partial.runtimeCheckpoint === undefined
      ? {}
      : {
          runtimeCheckpoint: partial.runtimeCheckpoint,
          runtimeCheckpointRevision: partial.runtimeCheckpoint.revision,
        }),
    createdAt: at,
    updatedAt: at,
  })
}

export async function seedProvisionedRow(
  partial: Parameters<typeof seedSandboxRow>[0] = {},
): Promise<void> {
  await seedSandboxRow(partial)
  await recordBootSteps({
    threadId: 'thr-1',
    steps: [{ step: EBootStep.Provision, state: EBootStepState.Running }],
  })
}

export const checkpointOf = (phase: SeededCheckpoint['phase']): SeededCheckpoint => ({
  threadId: 'thr-1',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'ses-1',
  revision: 1,
  reportedAt: new Date().toISOString(),
  transcript: { head: 0, count: 0, digest: 'c'.repeat(64) },
  phase,
})

export async function appendRaw(args: { type: string; body: string; threadId?: string }) {
  await db.transaction((tx) =>
    appendWithin({
      tx,
      threadId: args.threadId ?? 'thr-1',
      userId: 'usr-1',
      runId: 'run_seed',
      drafts: [{ type: args.type, body: args.body }],
    }),
  )
}

export function runDepsWith(
  args: {
    boot?: SandboxWakeBoot
    scoped?: ScopedConfigService
    signals?: ThreadSignalsService
    sdk?: VercelSdk
    log?: (line: string) => void
    telemetryPepper?: string
  } = {},
) {
  return {
    telemetryPepper: args.telemetryPepper,
    cipher,
    sdk: args.sdk ?? fakeSdk().sdk,
    scoped: args.scoped ?? fakeScoped(),
    boot: args.boot ?? fakeBoot().boot,
    signals: args.signals ?? inertSignals(),
    image: 'atlas-sandbox:latest',
    cloudUrl: 'https://api.byatlas.io',
    log: args.log ?? (() => undefined),
  }
}
