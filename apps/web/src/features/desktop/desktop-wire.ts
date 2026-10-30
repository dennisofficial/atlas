import { podConnectReplySchema, type PodConnectReply } from '@dltech/atlas-wire/web'
import { z } from 'zod'

export enum ELocalPodState {
  Running = 'running',
  Stopped = 'stopped',
  Missing = 'missing',
}

export const localPodSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  model: z.string().optional(),
  effort: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.iso.datetime(),
  state: z.enum(ELocalPodState),
})
export type LocalPod = z.infer<typeof localPodSchema>

export const createPodInputSchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
})
export type CreatePodInput = z.infer<typeof createPodInputSchema>

export const capabilitiesSchema = z.object({
  docker: z.boolean(),
  reason: z.string().optional(),
})
export type DesktopCapabilities = z.infer<typeof capabilitiesSchema>

export const podListSchema = z.object({ pods: z.array(localPodSchema) })

export const POD_NOT_RUNNING_CODE = 'pod-not-running'
const NOT_FOUND = 404
const CONFLICT = 409

export class DesktopError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(args: {
    message: string
    status: number
    code?: string | undefined
  }) {
    super(args.message)
    this.status = args.status
    this.code = args.code
  }
}

async function errorOf(response: Response): Promise<DesktopError> {
  const body: unknown = await response.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return new DesktopError({
    message: typeof record.message === 'string' ? record.message : response.statusText,
    status: response.status,
    code: typeof record.code === 'string' ? record.code : undefined,
  })
}

async function call<T>(args: {
  path: string
  schema: z.ZodType<T>
  method?: 'GET' | 'POST'
  body?: unknown
}): Promise<T> {
  const response = await fetch(args.path, {
    method: args.method ?? 'GET',
    ...(args.body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args.body),
        }),
  })
  if (!response.ok) throw await errorOf(response)
  return args.schema.parse(await response.json())
}

const podPath = (threadId: string) => `/desktop/pods/${encodeURIComponent(threadId)}`

let capabilities: Promise<DesktopCapabilities | null> | null = null

export function desktopCapabilities(): Promise<DesktopCapabilities | null> {
  capabilities ??= call({
    path: '/desktop/capabilities',
    schema: capabilitiesSchema,
  }).catch(() => null)
  return capabilities
}

export function resetDesktopCapabilities(): void {
  capabilities = null
}

export async function listLocalPods(): Promise<LocalPod[]> {
  if ((await desktopCapabilities()) === null) return []
  try {
    return (await call({ path: '/desktop/pods', schema: podListSchema })).pods
  } catch {
    return []
  }
}

export async function getLocalPod(threadId: string): Promise<LocalPod | null> {
  try {
    return await call({ path: podPath(threadId), schema: localPodSchema })
  } catch (failure) {
    if (failure instanceof DesktopError && failure.status === NOT_FOUND) return null
    throw failure
  }
}

export const createLocalPod = (input: CreatePodInput) =>
  call({
    path: '/desktop/pods',
    schema: localPodSchema,
    method: 'POST',
    body: input,
  })

export const wakeLocalPod = (threadId: string) =>
  call({
    path: `${podPath(threadId)}/wake`,
    schema: localPodSchema,
    method: 'POST',
  })

export async function connectLocalPod(threadId: string): Promise<PodConnectReply | null> {
  try {
    return await call({
      path: `${podPath(threadId)}/connect`,
      schema: podConnectReplySchema,
      method: 'POST',
    })
  } catch (failure) {
    if (
      failure instanceof DesktopError &&
      failure.status === CONFLICT &&
      failure.code === POD_NOT_RUNNING_CODE
    ) {
      return null
    }
    throw failure
  }
}
