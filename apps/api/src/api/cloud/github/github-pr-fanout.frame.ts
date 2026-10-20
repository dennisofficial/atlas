import { z } from 'zod'
import {
  EPrEventKind,
  type GithubPrEventDto,
  type GithubPrStateDto,
} from './github-realtime.types'

export const PR_FRAME_CHANNEL = 'atlas:github-pr'

export enum EPrFrameKind {
  State = 'state',
  Event = 'event',
}

export type PrFrame =
  | { kind: EPrFrameKind.State; userIds: readonly string[]; payload: GithubPrStateDto }
  | {
      kind: EPrFrameKind.Event
      userIds: readonly string[]
      payload: GithubPrEventDto
      ackId?: string
    }

const stateSchema = z.object({
  repoFullName: z.string(),
  prNumber: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  headBranch: z.string(),
  headSha: z.string(),
  checksRunning: z.number(),
  checksPassed: z.number(),
  checksFailed: z.number(),
  mergeable: z.boolean().nullable(),
  updatedAt: z.string(),
})

const eventSchema = z.object({
  id: z.string(),
  repoFullName: z.string(),
  prNumber: z.number(),
  kind: z.enum(EPrEventKind),
  payload: z.object({
    url: z.string(),
    authorLogin: z.string().exactOptional(),
    body: z.string().exactOptional(),
    reviewState: z.string().exactOptional(),
    verdict: z.enum(['green', 'failed']).exactOptional(),
    mergeable: z.boolean().exactOptional(),
    state: z.enum(['merged', 'closed']).exactOptional(),
    headSha: z.string().exactOptional(),
  }),
  createdAt: z.string(),
})

const prFrameSchema: z.ZodType<PrFrame> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EPrFrameKind.State),
    userIds: z.array(z.string()),
    payload: stateSchema,
  }),
  z.object({
    kind: z.literal(EPrFrameKind.Event),
    userIds: z.array(z.string()),
    payload: eventSchema,
    ackId: z.string().exactOptional(),
  }),
])

export function parsePrFrame({ raw }: { raw: string }): PrFrame | undefined {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return undefined
  }
  const result = prFrameSchema.safeParse(json)
  return result.success ? result.data : undefined
}
