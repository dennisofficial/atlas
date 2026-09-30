import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'

type AssistantMessage = Extract<LanguageModelV4Prompt[number], { role: 'assistant' }>
type AssistantPart = AssistantMessage['content'][number]
type ReasoningPart = Extract<AssistantPart, { type: 'reasoning' }>

type DroppedReason = 'foreign' | 'unencrypted'

type ReasoningMetadata = { itemId?: unknown; reasoningEncryptedContent?: unknown }

// LanguageModelV4ReasoningPart carries only providerOptions, but older ai versions moved response
// providerMetadata into the prompt untouched, so history assembled there still holds the SDK's
// stamps there. Anything read off this surface is forwarded into providerOptions, never trusted as
// the stamp itself. exactOptionalPropertyTypes makes the migration's rest-spread look optional-key
// incompatible, so the migrated part is built field by field instead.
type HistoricalReasoningPart = ReasoningPart & { providerMetadata?: SharedV4ProviderOptions }

const toCanonicalReasoningPart = (args: {
  namespace: string
  part: HistoricalReasoningPart
}): ReasoningPart => {
  const { providerMetadata, ...rest } = args.part
  const stamped = providerMetadata?.[args.namespace]
  if (stamped === undefined) return rest

  return {
    ...rest,
    providerOptions: { ...args.part.providerOptions, [args.namespace]: stamped },
  }
}

// The Responses converter only replays reasoning that carries its own itemId (a stored-item
// reference) or reasoningEncryptedContent, and with store:false it also drops anything lacking
// encrypted content (dist/index.js convertToOpenAIResponsesInput, @ai-sdk/openai 4.0.58). Anything
// else it rejects with a warning that JSON-stringifies the whole part, reasoning text included, so
// the parts are stripped here first with a single redacted diagnostic per call.
const metadataOf = (args: {
  namespace: string
  part: HistoricalReasoningPart
}): ReasoningMetadata => args.part.providerOptions?.[args.namespace] ?? args.part.providerMetadata?.[args.namespace] ?? {}

const isReplayable = (args: {
  namespace: string
  store: boolean
  part: HistoricalReasoningPart
}): boolean => {
  const metadata = metadataOf(args)
  if (typeof metadata.reasoningEncryptedContent === 'string') return true
  if (!args.store) return false
  return typeof metadata.itemId === 'string'
}

const dropReason = (args: {
  namespace: string
  store: boolean
  part: HistoricalReasoningPart
}): DroppedReason => {
  const metadata = metadataOf(args)
  if (typeof metadata.reasoningEncryptedContent !== 'string' && typeof metadata.itemId !== 'string')
    return 'foreign'
  return 'unencrypted'
}

const storeOption = (args: {
  namespace: string
  options: SharedV4ProviderOptions | undefined
}): boolean => args.options?.[args.namespace]?.['store'] !== false

const warnOmitted = (dropped: Readonly<Record<DroppedReason, number>>): void => {
  const foreign = dropped.foreign
  const unencrypted = dropped.unencrypted
  if (foreign === 0 && unencrypted === 0) return

  const reasons: string[] = []
  if (foreign > 0) reasons.push(`${foreign} from another provider's reasoning format`)
  if (unencrypted > 0) reasons.push(`${unencrypted} without encrypted content, which store:false requires`)
  console.warn(
    `atlas: omitted ${foreign + unencrypted} historical reasoning part(s) from the OpenAI request: ${reasons.join('; ')}. Text and tool calls are unaffected.`,
  )
}

// The reasoning case is the one place the converter does not read the custom provider's name:
// getArgs hardcodes `provider.includes("azure") ? "azure" : "openai"` (@ai-sdk/openai 4.0.58,
// dist/index.js:6818), so reasoning metadata lands under "openai" for every custom alias. The
// providerOptions side still answers for providers actually named "openai" (or containing
// "azure"), which covers the real subscription/api-key paths and their stamps.
const effectiveNamespace = (providerName: string): string =>
  providerName === 'openai' || providerName.includes('azure')
    ? providerName.split('.')[0]?.trim() ?? providerName
    : 'openai'

export function withOpenAiCompatibleReasoning(args: {
  namespace: string
  options: LanguageModelV4CallOptions
}): LanguageModelV4CallOptions {
  const namespace = effectiveNamespace(args.namespace)
  const store = storeOption({ namespace, options: args.options.providerOptions })

  const dropped: Record<DroppedReason, number> = { foreign: 0, unencrypted: 0 }
  let touched = false

  const prompt = args.options.prompt.map((message) => {
    if (message.role !== 'assistant') return message

    let migrated = false
    const content: AssistantPart[] = []
    for (const part of message.content) {
      if (part.type !== 'reasoning') {
        content.push(part)
        continue
      }
      const historical = part as HistoricalReasoningPart
      if (!isReplayable({ namespace, store, part: historical })) {
        dropped[dropReason({ namespace, store, part: historical })] += 1
        touched = true
        continue
      }
      if (historical.providerMetadata === undefined) {
        content.push(part)
        continue
      }
      migrated = true
      content.push(toCanonicalReasoningPart({ namespace, part: historical }))
    }

    if (!migrated && content.length === message.content.length) return message
    return { ...message, content }
  })

  warnOmitted(dropped)
  if (!touched) return args.options

  const canonical = prompt.filter(
    (message) => message.role !== 'assistant' || message.content.length > 0,
  )
  return { ...args.options, prompt: canonical }
}
