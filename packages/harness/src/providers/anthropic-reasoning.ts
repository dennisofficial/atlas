import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  SharedV4ProviderOptions,
} from '@ai-sdk/provider'

type AssistantMessage = Extract<LanguageModelV4Prompt[number], { role: 'assistant' }>
type AssistantPart = AssistantMessage['content'][number]
type ReasoningPart = Extract<AssistantPart, { type: 'reasoning' }>

type ReasoningMetadata = { signature?: unknown; redactedData?: unknown }

// LanguageModelV4ReasoningPart carries only providerOptions, but older ai versions moved response
// providerMetadata into the prompt untouched, so history assembled there still holds the SDK's
// stamps there. Anything read off this surface is forwarded into providerOptions, never trusted as
// the stamp itself.
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

// The Messages converter only replays reasoning whose anthropic namespace holds a signature (a
// thinking block Anthropic signed) or redactedData (a block Anthropic itself redacted);
// anthropicReasoningMetadataSchema, @ai-sdk/anthropic 4.0.49, dist/internal/index.js:921. Anything
// else it rejects with an "unsupported reasoning metadata" warning per part, so unsigned parts are
// stripped here first with a single redacted diagnostic per call.
const metadataOf = (args: {
  namespace: string
  part: HistoricalReasoningPart
}): ReasoningMetadata =>
  args.part.providerOptions?.[args.namespace] ?? args.part.providerMetadata?.[args.namespace] ?? {}

const isReplayable = (args: { namespace: string; part: HistoricalReasoningPart }): boolean => {
  const metadata = metadataOf(args)
  return typeof metadata.signature === 'string' || typeof metadata.redactedData === 'string'
}

const warnOmitted = (dropped: number): void => {
  if (dropped === 0) return
  console.warn(
    `atlas: omitted ${dropped} historical reasoning part(s) from the Anthropic request: no Anthropic signature to replay (Anthropic signs its thinking blocks, so reasoning from another provider cannot round-trip). Text and tool calls are unaffected.`,
  )
}

export function withAnthropicCompatibleReasoning(args: {
  namespace: string
  options: LanguageModelV4CallOptions
}): LanguageModelV4CallOptions {
  const namespace = args.namespace

  let dropped = 0
  let changed = false

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
      if (!isReplayable({ namespace, part: historical })) {
        dropped += 1
        changed = true
        continue
      }
      if (historical.providerMetadata === undefined) {
        content.push(part)
        continue
      }
      migrated = true
      changed = true
      content.push(toCanonicalReasoningPart({ namespace, part: historical }))
    }

    if (!migrated && content.length === message.content.length) return message
    return { ...message, content }
  })

  warnOmitted(dropped)
  if (!changed) return args.options

  const canonical = prompt.filter(
    (message) => message.role !== 'assistant' || message.content.length > 0,
  )
  return { ...args.options, prompt: canonical }
}
