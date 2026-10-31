import {
  podConnectReplySchema,
  podStatusSchema,
  podResizeInputSchema,
  podResizeReplySchema,
  type PodConnectReply,
} from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { desktopCall as call, DesktopError, hasDesktopHost } from './desktop-http'

export { DesktopError } from './desktop-http'

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

const podPath = (threadId: string) => `/desktop/pods/${encodeURIComponent(threadId)}`

export const fetchLocalPodStatus = (threadId: string) =>
  call({
    path: `${podPath(threadId)}/status`,
    schema: podStatusSchema,
  })

export const resizeLocalPod = (args: { threadId: string; vcpus: number }) => {
  const input = podResizeInputSchema.parse(args)
  return call({
    path: `${podPath(input.threadId)}/resize`,
    method: 'POST',
    body: { vcpus: input.vcpus },
    schema: podResizeReplySchema,
  })
}

let capabilities: Promise<DesktopCapabilities | null> | null = null

export function desktopCapabilities(): Promise<DesktopCapabilities | null> {
  if (!hasDesktopHost()) return Promise.resolve(null)
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
  if (!hasDesktopHost()) return []
  return (await call({ path: '/desktop/pods', schema: podListSchema })).pods
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

function validateLocalTicket(ticket: PodConnectReply): PodConnectReply {
  const url = new URL(ticket.url)
  if (
    !['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  )
    throw new Error('Invalid local pod ticket URL')
  return ticket
}

export async function connectLocalPod(threadId: string): Promise<PodConnectReply | null> {
  try {
    return validateLocalTicket(
      await call({
        path: `${podPath(threadId)}/connect`,
        schema: podConnectReplySchema,
        method: 'POST',
      }),
    )
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
