import { z } from 'zod'

import { EVercelCredentialGap, SANDBOX_SELF_BOOT_STEPS_PATH } from './sandbox-self-wire'

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

export const BOOT_STEP_ORDER: readonly EBootStep[] = [
  EBootStep.Provision,
  EBootStep.Serve,
  EBootStep.Clone,
  EBootStep.Context,
  EBootStep.Settings,
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

export const MAX_BOOT_STEP_TEXT = 2000

export const bootStepEventSchema = z.object({
  step: z.enum(EBootStep),
  state: z.enum(EBootStepState),
  detail: z.string().max(MAX_BOOT_STEP_TEXT).optional(),
  error: z.string().max(MAX_BOOT_STEP_TEXT).optional(),
  gap: z.enum(EVercelCredentialGap).optional(),
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
  track: <T>(args: {
    step: EBootStep
    detail?: string | undefined
    work: () => Promise<T>
  }) => Promise<T>
}

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function createBootReporter(args: {
  sink: BootStepSink
  log?: ((line: string) => void) | undefined
}): BootReporter {
  const report = async (event: BootStepEvent): Promise<void> => {
    try {
      await args.sink([event])
    } catch (failure) {
      args.log?.(`boot step ${event.step} ${event.state} was not reported: ${failureText(failure)}`)
    }
  }
  const track = async <T>(tracked: {
    step: EBootStep
    detail?: string | undefined
    work: () => Promise<T>
  }): Promise<T> => {
    const detail = tracked.detail === undefined ? {} : { detail: tracked.detail }
    await report({
      step: tracked.step,
      state: EBootStepState.Running,
      ...detail,
    })
    try {
      const result = await tracked.work()
      await report({
        step: tracked.step,
        state: EBootStepState.Done,
        ...detail,
      })
      return result
    } catch (failure) {
      await report({
        step: tracked.step,
        state: EBootStepState.Error,
        error: failureText(failure),
      })
      throw failure
    }
  }
  return { report, track }
}

export const NOOP_BOOT_REPORTER: BootReporter = {
  report: () => Promise.resolve(),
  track: (tracked) => tracked.work(),
}

/** Serve's strict sink: posts boot steps to the API's sandbox-token endpoint and throws when it is refused. */
export function serveBootSink(args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}): BootStepSink {
  const url = `${args.controlPlaneUrl.replace(/\/+$/, '')}${SANDBOX_SELF_BOOT_STEPS_PATH}`
  return async (events) => {
    const response = await args.fetchFn(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.token}`,
        'content-type': 'application/json',
        'atlas-client-version': args.clientVersion,
      },
      body: JSON.stringify(bootStepsPostSchema.parse({ steps: events })),
    })
    if (!response.ok) throw new Error(`the control plane answered ${response.status}`)
  }
}

/** Serve's reporter: posts boot steps outside the event log, swallowing sink failures. */
export function serveBootReporter(args: {
  controlPlaneUrl: string
  threadId: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log?: ((line: string) => void) | undefined
}): BootReporter {
  return createBootReporter({ log: args.log, sink: serveBootSink(args) })
}

export const recordedBootStepSchema = z.object({
  step: z.enum(EBootStep),
  state: z.enum(EBootStepState),
  error: z.string().optional(),
  gap: z.enum(EVercelCredentialGap).optional(),
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

export const podStatusSchema = z.object({
  state: z.enum(EPodState),
  steps: z.array(recordedBootStepSchema),
  history: z.array(recordedBootStepSchema).optional(),
})
export type PodStatus = z.infer<typeof podStatusSchema>

export const threadPodPath = (threadId: string): string =>
  `/v1/threads/${encodeURIComponent(threadId)}/pod`

export const podConnectReplySchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
})
export type PodConnectReply = z.infer<typeof podConnectReplySchema>

export const threadPodConnectPath = (threadId: string): string =>
  `${threadPodPath(threadId)}/connect`
