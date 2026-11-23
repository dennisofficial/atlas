import {
  DIAGRAM_ERROR_MAX,
  DIAGRAM_REPAIR_CONTEXT_MAX,
  DIAGRAM_SOURCE_MAX,
  diagramRepairOutcomeSchema,
} from '@dltech/atlas-core'
import { z } from 'zod'

export const diagramRepairInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  source: z.string().trim().min(1).max(DIAGRAM_SOURCE_MAX),
  error: z.string().min(1).max(DIAGRAM_ERROR_MAX),
  context: z
    .string()
    .max(DIAGRAM_REPAIR_CONTEXT_MAX + 8)
    .optional(),
})

export const diagramRepairOutputSchema = diagramRepairOutcomeSchema

export const diagramRepairListInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const diagramRepairEntrySchema = z.strictObject({
  source: z.string().min(1),
  outcome: diagramRepairOutcomeSchema,
})

export const diagramRepairListOutputSchema = z.strictObject({
  repairs: z.array(diagramRepairEntrySchema),
})

export type DiagramRepairInput = z.infer<typeof diagramRepairInputSchema>
export type DiagramRepairOutput = z.infer<typeof diagramRepairOutputSchema>
export type DiagramRepairListInput = z.infer<typeof diagramRepairListInputSchema>
export type DiagramRepairEntry = z.infer<typeof diagramRepairEntrySchema>
export type DiagramRepairListOutput = z.infer<typeof diagramRepairListOutputSchema>
