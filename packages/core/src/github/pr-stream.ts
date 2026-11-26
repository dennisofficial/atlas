import { z } from 'zod'

export enum EGithubPrStreamFrame {
  PrState = 'pr-state',
  PrEvent = 'pr-event',
  Heartbeat = 'heartbeat',
}

export const githubPrStateSchema = z.object({
  repoFullName: z.string(),
  prNumber: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  headBranch: z.string(),
  headSha: z.string(),
  checksRunning: z.number().int(),
  checksPassed: z.number().int(),
  checksFailed: z.number().int(),
  checksExpected: z.number().int().optional(),
  checksState: z.string().nullable().optional(),
  mergeable: z.boolean().nullable(),
  mergeQueued: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  version: z.number().int(),
  updatedAt: z.string(),
  polled: z.boolean().optional(),
  pollingInstallUrl: z.string().optional(),
})
export type GithubPrState = z.infer<typeof githubPrStateSchema>

export const githubPrEventSchema = z.object({
  id: z.string(),
  repoFullName: z.string(),
  prNumber: z.number().int(),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})
export type GithubPrEvent = z.infer<typeof githubPrEventSchema>

export const githubPrStreamFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(EGithubPrStreamFrame.PrState), state: githubPrStateSchema }),
  z.object({ type: z.literal(EGithubPrStreamFrame.PrEvent), event: githubPrEventSchema }),
  z.object({ type: z.literal(EGithubPrStreamFrame.Heartbeat) }),
])
export type GithubPrStreamFrame = z.infer<typeof githubPrStreamFrameSchema>
