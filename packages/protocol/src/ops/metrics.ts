import { z } from 'zod'

import { okResultSchema } from './result'

export const METRICS_INTERVAL_MS = 3_000
export const METRICS_RING_SIZE = 300

export const podSampleSchema = z
  .object({
    at: z.number().int().min(0),
    cpuPercent: z.number().min(0),
    ramBytes: z.number().int().min(0),
    ramLimitBytes: z.number().int().min(0).nullable(),
    throttled: z.boolean(),
    oomKills: z.number().int().min(0),
  })
  .strict()

export const metricsSubscribeOpSchema = z.object({ op: z.literal('metrics.subscribe') }).strict()

export const metricsUnsubscribeOpSchema = z
  .object({ op: z.literal('metrics.unsubscribe') })
  .strict()

export const metricsBacklogSchema = z
  .object({ samples: z.array(podSampleSchema).max(METRICS_RING_SIZE) })
  .strict()

export const metricsOpSchemas = [metricsSubscribeOpSchema, metricsUnsubscribeOpSchema] as const

export const metricsResultSchemas = [
  okResultSchema({ op: 'metrics.subscribe', value: metricsBacklogSchema }),
  okResultSchema({ op: 'metrics.unsubscribe', value: z.null() }),
] as const

export const metricsSampleEventSchema = z
  .object({ type: z.literal('metrics.sample'), sample: podSampleSchema })
  .strict()

export const metricsEventSchemas = [metricsSampleEventSchema] as const

export type PodSample = z.infer<typeof podSampleSchema>
export type PodMetricsBacklog = z.infer<typeof metricsBacklogSchema>
export type MetricsSampleEvent = z.infer<typeof metricsSampleEventSchema>
