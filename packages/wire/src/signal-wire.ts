import { z } from 'zod'

export enum EFinishReason {
  Stop = 'stop',
  Length = 'length',
  ToolCalls = 'tool-calls',
  ContentFilter = 'content-filter',
  Error = 'error',
  Other = 'other',
}

export enum ERetryReason {
  RateLimited = 'rate-limited',
  Overloaded = 'overloaded',
  ServerError = 'server-error',
  Network = 'network',
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type ProviderOptions = Record<string, Record<string, JsonValue>>

const providerOptionsSchema = z.custom<ProviderOptions>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
)

const modelUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
})

const callIdWireSchema = z.string().min(1).brand<'CallId'>()
const eventIdWireSchema = z.string().min(1).brand<'EventId'>()

type CallIdWire = z.infer<typeof callIdWireSchema>

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number | undefined
  cacheWriteTokens?: number | undefined
}

export type Chunk =
  | { type: 'text-start'; id: string; providerMetadata?: ProviderOptions | undefined }
  | { type: 'text-delta'; id: string; text: string; providerMetadata?: ProviderOptions | undefined }
  | { type: 'text-end'; id: string; providerMetadata?: ProviderOptions | undefined }
  | { type: 'reasoning-start'; id: string; providerMetadata?: ProviderOptions | undefined }
  | { type: 'reasoning-delta'; id: string; text: string; providerMetadata?: ProviderOptions | undefined }
  | { type: 'reasoning-end'; id: string; providerMetadata?: ProviderOptions | undefined }
  | { type: 'tool-input-start'; callId: CallIdWire; name: string }
  | { type: 'tool-input-delta'; callId: CallIdWire; text: string }
  | { type: 'tool-input-end'; callId: CallIdWire }
  | { type: 'tool-call'; callId: CallIdWire; name: string; input: unknown }
  | { type: 'finish'; reason: EFinishReason; usage?: ModelUsage | undefined }
  | { type: 'error'; message: string }

export const chunkWireSchema: z.ZodType<Chunk> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-start'), id: z.string(), providerMetadata: providerOptionsSchema.optional() }),
  z.object({
    type: z.literal('text-delta'),
    id: z.string(),
    text: z.string(),
    providerMetadata: providerOptionsSchema.optional(),
  }),
  z.object({ type: z.literal('text-end'), id: z.string(), providerMetadata: providerOptionsSchema.optional() }),
  z.object({
    type: z.literal('reasoning-start'),
    id: z.string(),
    providerMetadata: providerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('reasoning-delta'),
    id: z.string(),
    text: z.string(),
    providerMetadata: providerOptionsSchema.optional(),
  }),
  z.object({
    type: z.literal('reasoning-end'),
    id: z.string(),
    providerMetadata: providerOptionsSchema.optional(),
  }),
  z.object({ type: z.literal('tool-input-start'), callId: callIdWireSchema, name: z.string() }),
  z.object({ type: z.literal('tool-input-delta'), callId: callIdWireSchema, text: z.string() }),
  z.object({ type: z.literal('tool-input-end'), callId: callIdWireSchema }),
  z.object({
    type: z.literal('tool-call'),
    callId: callIdWireSchema,
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('finish'),
    reason: z.enum(EFinishReason),
    usage: modelUsageSchema.optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
])

export enum EStepEnd {
  Completed = 'completed',
  Interrupted = 'interrupted',
  Failed = 'failed',
  Retried = 'retried',
}

const stepIdWireSchema = z.string().min(1).brand<'StepId'>()

const eventRefWireSchema = z.object({ eventId: eventIdWireSchema, seq: z.number().int() })

export const channelSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step-started'), stepId: stepIdWireSchema }),
  z.object({ type: z.literal('chunk'), stepId: stepIdWireSchema, chunk: chunkWireSchema }),
  z.object({
    type: z.literal('step-ended'),
    stepId: stepIdWireSchema,
    end: z.enum(EStepEnd),
    supersededBy: eventRefWireSchema.nullable(),
  }),
  z.object({ type: z.literal('tool-output'), callId: callIdWireSchema, text: z.string() }),
  z.object({ type: z.literal('events-appended') }),
  z.object({
    type: z.literal('retry-waiting'),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    delayMs: z.number().int().nonnegative(),
    reason: z.enum(ERetryReason),
  }),
  z.object({ type: z.literal('retry-cleared') }),
])

export type ChannelSignal = z.infer<typeof channelSignalSchema>
