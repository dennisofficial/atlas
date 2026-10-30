import { z } from 'zod'

import { EVercelCredentialGap } from './sandbox-self-wire'
import { sandboxVcpusSchema } from './web/setting-enums'

export enum EBootStep {
  Provision = 'provision',
  Serve = 'serve',
  Clone = 'clone',
  Context = 'context',
  Settings = 'settings',
  Agent = 'agent',
}

export enum EBootStepState {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
}

export enum EBootStepOutcome {
  Created = 'created',
  Resumed = 'resumed',
  Cloned = 'cloned',
  Reused = 'reused',
  NoRepository = 'no-repository',
}

export const BOOT_STEP_ORDER: readonly EBootStep[] = [
  EBootStep.Provision,
  EBootStep.Serve,
  EBootStep.Clone,
  EBootStep.Settings,
  EBootStep.Context,
  EBootStep.Agent,
]

export const BOOT_STEP_EVENT_TYPE = 'sandbox-boot-step'
/**
 * Set to '1' on a sandbox the API provisioned. Serve then reports boot steps and routes port
 * exposure and stop through the API, because such a sandbox carries no Vercel credentials.
 */
export const API_PROVISIONED_ENV = 'ATLAS_API_PROVISIONED'

export const isApiProvisioned = (env: Record<string, string | undefined>): boolean =>
  env[API_PROVISIONED_ENV] === '1'

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''

export const writesBehind = (env: Record<string, string | undefined>): boolean =>
  isApiProvisioned(env) || (present(env.ATLAS_CLOUD_URL) && present(env.ATLAS_SERVE_TOKEN))

export const POD_NAME_ENV = 'ATLAS_POD_NAME'

export const isLocalPod = (env: Record<string, string | undefined>): boolean =>
  present(env[POD_NAME_ENV])

export const mirrorsThreadState = (env: Record<string, string | undefined>): boolean =>
  writesBehind(env) && !isLocalPod(env)

export const MAX_BOOT_STEP_TEXT = 2000
export const MAX_CLONE_REPOS = 20

export const cloneRepoProgressSchema = z.object({
  repo: z.string().min(1).max(200),
  state: z.enum(EBootStepState),
  error: z.string().max(MAX_BOOT_STEP_TEXT).optional(),
})
export type CloneRepoProgress = z.infer<typeof cloneRepoProgressSchema>

export const bootStepEventSchema = z.object({
  step: z.enum(EBootStep),
  state: z.enum(EBootStepState),
  detail: z.string().max(MAX_BOOT_STEP_TEXT).optional(),
  error: z.string().max(MAX_BOOT_STEP_TEXT).optional(),
  gap: z.enum(EVercelCredentialGap).optional(),
  outcome: z.enum(EBootStepOutcome).optional(),
  repos: z.array(cloneRepoProgressSchema).max(MAX_CLONE_REPOS).optional(),
})
export type BootStepEvent = z.infer<typeof bootStepEventSchema>

export type BootStepStatus = Omit<BootStepEvent, 'step'>

export const foldBootSteps = (
  events: readonly BootStepEvent[],
): Record<EBootStep, BootStepStatus> => {
  const folded = Object.fromEntries(
    BOOT_STEP_ORDER.map((step) => [step, { state: EBootStepState.Pending }]),
  ) as Record<EBootStep, BootStepStatus>
  for (const event of events) {
    const { step, ...status } = event
    folded[step] = status
  }
  return folded
}

export type BootStepSink = (events: readonly BootStepEvent[]) => Promise<void>

export type BootReporter = {
  report: (event: BootStepEvent) => Promise<void>
  flush: () => Promise<void>
  track: <T>(args: {
    step: EBootStep
    detail?: string | undefined
    work: () => Promise<T>
    outcomeOf?: ((result: T) => EBootStepOutcome) | undefined
  }) => Promise<T>
}

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const MAX_BATCH = 50

const bounded = (text: string): string => text.slice(0, MAX_BOOT_STEP_TEXT)

const boundedEvent = (event: BootStepEvent): BootStepEvent => ({
  ...event,
  ...(event.detail === undefined ? {} : { detail: bounded(event.detail) }),
  ...(event.error === undefined ? {} : { error: bounded(event.error) }),
  ...(event.repos === undefined
    ? {}
    : {
        repos: event.repos.map((repo) =>
          repo.error === undefined ? repo : { ...repo, error: bounded(repo.error) },
        ),
      }),
})

export function createBootReporter(args: {
  sink: BootStepSink
  log?: ((line: string) => void) | undefined
}): BootReporter {
  const queue: BootStepEvent[] = []
  let delivery: Promise<void> | undefined

  const deliver = async (batch: BootStepEvent[]): Promise<void> => {
    try {
      await args.sink(batch)
    } catch (failure) {
      for (const event of batch) {
        try {
          args.log?.(
            `boot step ${event.step} ${event.state} was not reported: ${failureText(failure)}`,
          )
        } catch {}
      }
    }
  }

  const drain = async (): Promise<void> => {
    try {
      while (queue.length > 0) await deliver(queue.splice(0, MAX_BATCH))
    } finally {
      delivery = undefined
    }
  }

  const enqueue = (event: BootStepEvent): void => {
    queue.push(boundedEvent(event))
    delivery ??= Promise.resolve().then(drain)
  }

  const report = (event: BootStepEvent): Promise<void> => {
    enqueue(event)
    return Promise.resolve()
  }

  const flush = async (): Promise<void> => {
    while (delivery !== undefined) await delivery
  }

  const track = async <T>(tracked: {
    step: EBootStep
    detail?: string | undefined
    work: () => Promise<T>
    outcomeOf?: ((result: T) => EBootStepOutcome) | undefined
  }): Promise<T> => {
    const detail = tracked.detail === undefined ? {} : { detail: tracked.detail }
    enqueue({ step: tracked.step, state: EBootStepState.Running, ...detail })
    try {
      const result = await tracked.work()
      const outcome = tracked.outcomeOf?.(result)
      enqueue({
        step: tracked.step,
        state: EBootStepState.Done,
        ...detail,
        ...(outcome === undefined ? {} : { outcome }),
      })
      return result
    } catch (failure) {
      enqueue({ step: tracked.step, state: EBootStepState.Error, error: failureText(failure) })
      throw failure
    }
  }
  return { report, track, flush }
}

export const NOOP_BOOT_REPORTER: BootReporter = {
  report: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  track: (tracked) => tracked.work(),
}

export const recordedBootStepSchema = z.object({
  step: z.enum(EBootStep),
  state: z.enum(EBootStepState),
  error: z.string().optional(),
  gap: z.enum(EVercelCredentialGap).optional(),
  outcome: z.enum(EBootStepOutcome).optional(),
  repos: z.array(cloneRepoProgressSchema).optional(),
  at: z.string(),
})
export type RecordedBootStep = z.infer<typeof recordedBootStepSchema>

const atMsOf = (step: RecordedBootStep): number => Date.parse(step.at)

const isProvisionRunning = (step: RecordedBootStep): boolean =>
  step.step === EBootStep.Provision && step.state === EBootStepState.Running

function startsAttempt(args: {
  step: RecordedBootStep
  current: readonly RecordedBootStep[]
}): boolean {
  const { step, current } = args
  if (step.step !== EBootStep.Provision) return false
  if (step.state === EBootStepState.Running) return !current.every(isProvisionRunning)
  const provision = current.findLast((recorded) => recorded.step === EBootStep.Provision)
  return provision !== undefined && provision.state !== EBootStepState.Running
}

/** Splits a thread's whole boot history into attempts, oldest first. */
export function bootAttemptsOf(steps: readonly RecordedBootStep[]): RecordedBootStep[][] {
  const ordered = [...steps].sort((left, right) => atMsOf(left) - atMsOf(right))
  const attempts: RecordedBootStep[][] = []
  for (const step of ordered) {
    const current = attempts.at(-1)
    if (current === undefined || startsAttempt({ step, current })) attempts.push([step])
    else current.push(step)
  }
  return attempts
}

export const latestBootAttemptOf = (steps: readonly RecordedBootStep[]): RecordedBootStep[] =>
  bootAttemptsOf(steps).at(-1) ?? []

export const bootStepsPostSchema = z.object({
  steps: z.array(bootStepEventSchema).min(1).max(50),
})
export type BootStepsPost = z.infer<typeof bootStepsPostSchema>

export enum EPodState {
  None = 'none',
  Booting = 'booting',
  Running = 'running',
  Parked = 'parked',
  Failed = 'failed',
}

export const podResourcesSchema = z.object({
  sandboxId: z.string(),
  region: z.string(),
  vcpus: z.number().int().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  pendingVcpus: z.number().int().positive().optional(),
})
export type PodResources = z.infer<typeof podResourcesSchema>

export const podResizeInputSchema = z.strictObject({
  threadId: z.string().min(1),
  vcpus: sandboxVcpusSchema,
})
export type PodResizeInput = z.infer<typeof podResizeInputSchema>

export enum EPodResizeApplies {
  Live = 'live',
}

export const podResizeReplySchema = z.object({
  vcpus: z.number().int().positive(),
  appliesAt: z.enum(EPodResizeApplies),
})
export type PodResizeReply = z.infer<typeof podResizeReplySchema>

export const podStatusSchema = z.object({
  state: z.enum(EPodState),
  resources: podResourcesSchema.optional(),
  steps: z.array(recordedBootStepSchema),
  history: z.array(recordedBootStepSchema).optional(),
})
export type PodStatus = z.infer<typeof podStatusSchema>

export const podConnectReplySchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
})
export type PodConnectReply = z.infer<typeof podConnectReplySchema>
