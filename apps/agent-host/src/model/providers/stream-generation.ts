import type {
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Reasoning,
  LanguageModelV4ResponseMetadata,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Text,
  SharedV4ProviderMetadata,
  SharedV4Warning,
} from '@ai-sdk/provider'

enum ETextBlockKind {
  Text = 'text',
  Reasoning = 'reasoning',
}
type TextBlock = LanguageModelV4Text | LanguageModelV4Reasoning
type FinishPart = Extract<LanguageModelV4StreamPart, { type: 'finish' }>

export class StreamEndedWithoutFinishError extends Error {
  constructor() {
    super('The model stream closed before reporting that the response finished.')
    this.name = 'StreamEndedWithoutFinishError'
  }
}

const mergedMetadata = ({
  base,
  extra,
}: {
  base: SharedV4ProviderMetadata | undefined
  extra: SharedV4ProviderMetadata | undefined
}): SharedV4ProviderMetadata | undefined => {
  if (extra === undefined) return base
  if (base === undefined) return extra

  const merged: SharedV4ProviderMetadata = { ...base }
  for (const [namespace, values] of Object.entries(extra)) {
    merged[namespace] = { ...merged[namespace], ...values }
  }
  return merged
}

const failureOf = (error: unknown): Error =>
  error instanceof Error ? error : new Error(`The model stream reported an error: ${String(error)}`)

export async function generationFromStream({
  result,
  isTerminalPart,
}: {
  result: LanguageModelV4StreamResult
  isTerminalPart?: ((part: LanguageModelV4StreamPart) => boolean) | undefined
}): Promise<LanguageModelV4GenerateResult> {
  const content: LanguageModelV4Content[] = []
  const warnings: SharedV4Warning[] = []
  const blocks = new Map<string, TextBlock>()
  let response: LanguageModelV4ResponseMetadata = {}
  let finish: FinishPart | undefined
  let reachedTerminal = isTerminalPart === undefined

  const blockFor = ({ kind, id }: { kind: ETextBlockKind; id: string }): TextBlock => {
    const key = `${kind}:${id}`
    const existing = blocks.get(key)
    if (existing !== undefined) return existing

    const created: TextBlock = { type: kind, text: '' }
    blocks.set(key, created)
    content.push(created)
    return created
  }

  const growBlock = ({
    kind,
    id,
    delta,
    providerMetadata,
  }: {
    kind: ETextBlockKind
    id: string
    delta?: string
    providerMetadata: SharedV4ProviderMetadata | undefined
  }): void => {
    const block = blockFor({ kind, id })
    block.text += delta ?? ''

    const metadata = mergedMetadata({ base: block.providerMetadata, extra: providerMetadata })
    if (metadata !== undefined) block.providerMetadata = metadata
  }

  const absorb = (part: LanguageModelV4StreamPart): void => {
    switch (part.type) {
      case 'stream-start':
        warnings.push(...part.warnings)
        return
      case 'response-metadata':
        response = {
          ...response,
          ...(part.id === undefined ? {} : { id: part.id }),
          ...(part.timestamp === undefined ? {} : { timestamp: part.timestamp }),
          ...(part.modelId === undefined ? {} : { modelId: part.modelId }),
        }
        return
      case 'text-start':
      case 'text-end':
        growBlock({
          kind: ETextBlockKind.Text,
          id: part.id,
          providerMetadata: part.providerMetadata,
        })
        return
      case 'text-delta':
        growBlock({
          kind: ETextBlockKind.Text,
          id: part.id,
          delta: part.delta,
          providerMetadata: part.providerMetadata,
        })
        return
      case 'reasoning-start':
      case 'reasoning-end':
        growBlock({
          kind: ETextBlockKind.Reasoning,
          id: part.id,
          providerMetadata: part.providerMetadata,
        })
        return
      case 'reasoning-delta':
        growBlock({
          kind: ETextBlockKind.Reasoning,
          id: part.id,
          delta: part.delta,
          providerMetadata: part.providerMetadata,
        })
        return
      case 'file':
      case 'reasoning-file':
      case 'source':
      case 'tool-call':
      case 'tool-result':
      case 'tool-approval-request':
      case 'custom':
        content.push(part)
        return
      case 'finish':
        finish = part
        return
      case 'error':
        throw failureOf(part.error)
      case 'tool-input-start':
      case 'tool-input-delta':
      case 'tool-input-end':
      case 'raw':
        return
    }
  }

  const reader = result.stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (isTerminalPart?.(value)) reachedTerminal = true
      absorb(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  if (finish === undefined || !reachedTerminal) throw new StreamEndedWithoutFinishError()

  const headers = result.response?.headers
  return {
    content,
    finishReason: finish.finishReason,
    usage: finish.usage,
    warnings,
    response: { ...response, ...(headers === undefined ? {} : { headers }) },
    ...(finish.providerMetadata === undefined ? {} : { providerMetadata: finish.providerMetadata }),
    ...(result.request === undefined ? {} : { request: result.request }),
  }
}
