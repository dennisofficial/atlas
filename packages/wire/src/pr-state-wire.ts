import { z } from 'zod'

export enum EPullRequestStateWire {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
}

export const prStateWireSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
  url: z.string(),
  branch: z.string(),
  state: z.enum(EPullRequestStateWire),
  checksRunning: z.number().int().nonnegative(),
  checksPassed: z.number().int().nonnegative(),
  checksFailed: z.number().int().nonnegative(),
  mergeable: z.boolean().nullable(),
})

export type PrStateWire = z.infer<typeof prStateWireSchema>

export const prStatesWireSchema = z.object({ states: z.array(prStateWireSchema) })

export type PrStatesWire = z.infer<typeof prStatesWireSchema>
