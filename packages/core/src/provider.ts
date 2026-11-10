import type { JsonValue } from './json/value'

export type ProviderOptions = Record<string, Record<string, JsonValue>>

export type ProviderIdentity = { id: string; modelId: string }

export const ANTHROPIC_MODEL_PREFIX = 'anthropic/'

/** Gateway model ids carry their owner as a prefix, so the protocol follows the model, not the route. */
export const isAnthropicModel = (modelId: string): boolean =>
  modelId.startsWith(ANTHROPIC_MODEL_PREFIX)

/** Which upstream account served a call, and how the gateway identified the session. */
export type GatewayRouting = {
  readonly finalProvider?: string | undefined
  readonly sessionIdSource?: string | undefined
}

const recordAt = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const found = (value as Record<string, unknown>)[key]
  return typeof found === 'object' && found !== null
    ? (found as Record<string, unknown>)
    : undefined
}

const stringAt = (value: Record<string, unknown> | undefined, key: string): string | undefined => {
  const found = value?.[key]
  return typeof found === 'string' ? found : undefined
}

/**
 * The gateway reports routing under `providerMetadata.gateway.routing`, which the installed SDK
 * types do not declare: its gateway metadata carries only `asyncJob` plus an index signature.
 * https://vercel.com/docs/ai-gateway/models-and-providers/session-affinity
 */
/** Routing from a settled model step, or nothing when the provider reports none. */
export async function gatewayRoutingOf(
  step: PromiseLike<{ readonly providerMetadata: unknown }>,
): Promise<GatewayRouting | undefined> {
  try {
    return readGatewayRouting((await step).providerMetadata)
  } catch {
    return undefined
  }
}

export function readGatewayRouting(providerMetadata: unknown): GatewayRouting | undefined {
  const routing = recordAt(recordAt(providerMetadata, 'gateway'), 'routing')
  const finalProvider = stringAt(routing, 'finalProvider')
  const sessionIdSource = stringAt(routing, 'sessionIdSource')

  return finalProvider === undefined && sessionIdSource === undefined
    ? undefined
    : { finalProvider, sessionIdSource }
}
