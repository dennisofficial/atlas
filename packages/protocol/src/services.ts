import { z } from 'zod'

export const servicesLogInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  serviceId: z.string().min(1),
})
export type ServicesLogInput = z.infer<typeof servicesLogInputSchema>

export const servicesLogOutputSchema = z.strictObject({
  text: z.string(),
  truncated: z.boolean(),
})
export type ServicesLogOutput = z.infer<typeof servicesLogOutputSchema>
