import { z } from 'zod'

export enum EPullRequestStateWire {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
}

export enum EPullRequestChecksStateWire {
  Expected = 'expected',
  Pending = 'pending',
  Success = 'success',
  Failure = 'failure',
  Error = 'error',
}

export const prStateWireSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
  url: z.string(),
  branch: z.string(),
  state: z.enum(EPullRequestStateWire),
  title: z.string().optional(),
  checksRunning: z.number().int().nonnegative(),
  checksPassed: z.number().int().nonnegative(),
  checksFailed: z.number().int().nonnegative(),
  checksState: z.enum(EPullRequestChecksStateWire).nullable().optional(),
  mergeable: z.boolean().nullable(),
  polled: z.boolean().optional(),
})

export type PrStateWire = z.infer<typeof prStateWireSchema>

export const prStatesWireSchema = z.object({ states: z.array(prStateWireSchema) })

export type PrStatesWire = z.infer<typeof prStatesWireSchema>
