import { z } from 'zod'

import { eventIdSchema, type EventId } from '../events/ids'

export type DiagramRepairedBody = {
  type: 'diagram-repaired'
  messageId: EventId
  original: string
  repaired: string
  modelId: string
}

export const diagramRepairedSchema = z.object({
  type: z.literal('diagram-repaired'),
  messageId: eventIdSchema,
  original: z.string().min(1),
  repaired: z.string().min(1),
  modelId: z.string().min(1),
})

export const isDiagramRepaired = (event: { type: string }): event is DiagramRepairedBody =>
  event.type === 'diagram-repaired'
