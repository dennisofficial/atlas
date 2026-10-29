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

export const POD_NOT_RUNNING_CODE = 'pod-not-running'
