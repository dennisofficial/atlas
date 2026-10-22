import { z } from 'zod'

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
export const BOOT_RUN_ID = 'run_sandbox-boot'
/**
 * Set to '1' on a sandbox the API provisioned. Serve then reports boot steps and routes port
 * exposure and stop through the API, because such a sandbox carries no Vercel credentials.
 */
export const API_PROVISIONED_ENV = 'ATLAS_API_PROVISIONED'

export const isApiProvisioned = (env: Record<string, string | undefined>): boolean =>
  env[API_PROVISIONED_ENV] === '1'

export const bootStepEventSchema = z.object({
  step: z.enum(EBootStep),
  state: z.enum(EBootStepState),
  detail: z.string().optional(),
  error: z.string().optional(),
})
export type BootStepEvent = z.infer<typeof bootStepEventSchema>

export type BootStepDraft = { type: typeof BOOT_STEP_EVENT_TYPE; body: string }

export const bootStepDraftOf = (event: BootStepEvent): BootStepDraft => ({
  type: BOOT_STEP_EVENT_TYPE,
  body: JSON.stringify(bootStepEventSchema.parse(event)),
})

export const bootStepOfWire = (wire: { type: string; body: string }): BootStepEvent | null => {
  if (wire.type !== BOOT_STEP_EVENT_TYPE) return null
  try {
    const parsed = bootStepEventSchema.safeParse(JSON.parse(wire.body))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

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
    await report({ step: tracked.step, state: EBootStepState.Running, ...detail })
    try {
      const result = await tracked.work()
      await report({ step: tracked.step, state: EBootStepState.Done, ...detail })
      return result
    } catch (failure) {
      await report({ step: tracked.step, state: EBootStepState.Error, error: failureText(failure) })
      throw failure
    }
  }
  return { report, track }
}

export const NOOP_BOOT_REPORTER: BootReporter = {
  report: () => Promise.resolve(),
  track: (tracked) => tracked.work(),
}

/** Serve's sink: appends to the thread's API event stream with the sandbox's own session token. */
export function serveBootReporter(args: {
  controlPlaneUrl: string
  threadId: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log?: ((line: string) => void) | undefined
}): BootReporter {
  const url = `${args.controlPlaneUrl.replace(/\/+$/, '')}/v1/threads/${encodeURIComponent(args.threadId)}/events`
  return createBootReporter({
    log: args.log,
    sink: async (events) => {
      const response = await args.fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${args.token}`,
          'content-type': 'application/json',
          'atlas-client-version': args.clientVersion,
        },
        body: JSON.stringify({ runId: BOOT_RUN_ID, drafts: events.map(bootStepDraftOf) }),
      })
      if (!response.ok) throw new Error(`the control plane answered ${response.status}`)
    },
  })
}

export const recordedBootStepSchema = z.object({
  step: z.enum(EBootStep),
  state: z.enum(EBootStepState),
  error: z.string().optional(),
  at: z.string(),
})
export type RecordedBootStep = z.infer<typeof recordedBootStepSchema>

export const bootStepsPostSchema = z.object({ steps: z.array(bootStepEventSchema).min(1).max(50) })
export type BootStepsPost = z.infer<typeof bootStepsPostSchema>

export enum EPodState {
  None = 'none',
  Booting = 'booting',
  Running = 'running',
  Failed = 'failed',
}

export const podStatusSchema = z.object({
  state: z.enum(EPodState),
  steps: z.array(recordedBootStepSchema),
})
export type PodStatus = z.infer<typeof podStatusSchema>

export const threadPodPath = (threadId: string): string =>
  `/v1/threads/${encodeURIComponent(threadId)}/pod`
