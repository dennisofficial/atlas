import { APICallError } from '@ai-sdk/provider'

import { causeChainOf } from '@dltech/atlas-agent'
import type { ProviderPrompt, ToolDeclaration } from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'

const CLIENT_ERROR_FLOOR = 400
const CLIENT_ERROR_CEILING = 500

export type ProviderRefusal = {
  status: number
  modelId: string
  providerType: string | undefined
  providerMessage: string
  systemBytes: number
  messageBytes: number
  toolBytes: number
  toolNames: readonly string[]
}

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')

const apiCallErrorOf = (error: unknown): APICallError | undefined => {
  for (const link of causeChainOf(error)) {
    if (APICallError.isInstance(link)) return link
  }
  return undefined
}

const isClientError = (status: number): boolean =>
  status >= CLIENT_ERROR_FLOOR && status < CLIENT_ERROR_CEILING

const providerTypeOf = (error: APICallError): string | undefined => {
  const data: unknown = error.data
  if (typeof data !== 'object' || data === null) return undefined
  const nested: unknown = (data as { error?: unknown }).error
  if (typeof nested !== 'object' || nested === null) return undefined
  const type: unknown = (nested as { type?: unknown }).type
  return typeof type === 'string' ? type : undefined
}

export const providerRefusalOf = (args: {
  error: unknown
  prompt: ProviderPrompt
  tools: readonly ToolDeclaration[]
}): ProviderRefusal | undefined => {
  const error = apiCallErrorOf(args.error)
  const status = error?.statusCode
  if (error === undefined || status === undefined || !isClientError(status)) return undefined

  return {
    status,
    modelId: args.prompt.provider.modelId,
    providerType: providerTypeOf(error),
    providerMessage: error.message,
    systemBytes: bytesOf(args.prompt.instructions),
    messageBytes: bytesOf(args.prompt.messages),
    toolBytes: args.tools.reduce(
      (sum, tool) => sum + Buffer.byteLength(tool.description, 'utf8'),
      0,
    ),
    toolNames: args.tools.map((tool) => tool.name),
  }
}

export const logProviderRefusal = (args: {
  log: LogPort | undefined
  error: unknown
  prompt: ProviderPrompt
  tools: readonly ToolDeclaration[]
}): void => {
  const refusal = providerRefusalOf(args)
  if (refusal === undefined) return

  args.log?.warn({
    source: 'model',
    message: `${refusal.modelId} refused the request with ${refusal.status}: ${refusal.providerMessage}`,
    data: { ...refusal },
  })
}
