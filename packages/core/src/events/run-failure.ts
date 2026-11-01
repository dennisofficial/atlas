import { z } from 'zod'

import { classifyProviderFailure, EProviderFailureKind } from '../models/provider-failure'

export enum ERunFailureKind {
  Auth = 'auth',
  Quota = 'quota',
  RateLimited = 'rate-limited',
  Network = 'network',
  Overloaded = 'overloaded',
  MissingCredential = 'missing-credential',
  Stalled = 'stalled',
  Delivery = 'delivery',
  ModelDenied = 'model-denied',
  ContextOverflow = 'context-overflow',
  ExchangeFault = 'exchange-fault',
  LoopGuard = 'loop-guard',
  ToolSettlement = 'tool-settlement',
  FinishFault = 'finish-fault',
  AgentFailed = 'agent-failed',
  Crashed = 'crashed',
  Other = 'other',
}

export type RunFailureAgent = {
  agentId: string
  agentType: string
  intent: string
}

export type RunFailure = {
  kind: ERunFailureKind
  message: string
  statusCode?: number | undefined
  providerCode?: string | undefined
  providerId?: string | undefined
  modelId?: string | undefined
  accountId?: string | undefined
  retryAt?: string | undefined
  resetAt?: string | undefined
  agent?: RunFailureAgent | undefined
}

export const runFailureSchema: z.ZodType<RunFailure> = z.object({
  kind: z.enum(ERunFailureKind).catch(ERunFailureKind.Other),
  message: z.string(),
  statusCode: z.number().int().optional(),
  providerCode: z.string().optional(),
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  retryAt: z.string().optional(),
  resetAt: z.string().optional(),
  agent: z
    .object({
      agentId: z.string().min(1),
      agentType: z.string(),
      intent: z.string(),
    })
    .optional(),
})

const RUN_KIND_OF_PROVIDER_KIND: Readonly<Record<EProviderFailureKind, ERunFailureKind>> = {
  [EProviderFailureKind.Auth]: ERunFailureKind.Auth,
  [EProviderFailureKind.Quota]: ERunFailureKind.Quota,
  [EProviderFailureKind.RateLimited]: ERunFailureKind.RateLimited,
  [EProviderFailureKind.Network]: ERunFailureKind.Network,
  [EProviderFailureKind.Overloaded]: ERunFailureKind.Overloaded,
  [EProviderFailureKind.Stalled]: ERunFailureKind.Stalled,
  [EProviderFailureKind.Delivery]: ERunFailureKind.Delivery,
  [EProviderFailureKind.ModelDenied]: ERunFailureKind.ModelDenied,
  [EProviderFailureKind.ContextOverflow]: ERunFailureKind.ContextOverflow,
  [EProviderFailureKind.InvalidRequest]: ERunFailureKind.Other,
  [EProviderFailureKind.Cancelled]: ERunFailureKind.Other,
  [EProviderFailureKind.Other]: ERunFailureKind.Other,
}

export const runFailureKindOfProviderKind = (kind: EProviderFailureKind): ERunFailureKind =>
  RUN_KIND_OF_PROVIDER_KIND[kind]

export function runFailureKindOf(args: {
  statusCode?: number | undefined
  providerCode?: string | number | undefined
  providerType?: string | undefined
  providerId?: string | undefined
  providerMessage?: string | undefined
  dropped?: boolean | undefined
  authorizationDelivered?: boolean | undefined
}): ERunFailureKind {
  const normalized = classifyProviderFailure({
    evidence: {
      message: args.providerMessage ?? '',
      statusCode: args.statusCode,
      providerCode: args.providerCode === undefined ? undefined : String(args.providerCode),
      providerType: args.providerType,
      providerId: args.providerId,
      providerMessage: args.providerMessage,
      transport: args.dropped,
      authorizationDelivered: args.authorizationDelivered,
    },
  })
  return runFailureKindOfProviderKind(normalized.kind)
}

export enum ERunRemedy {
  Retry = 'retry',
  Resume = 'resume',
  FixCredential = 'fix-credential',
  SwitchModel = 'switch-model',
  OpenAgent = 'open-agent',
  Compact = 'compact',
}

export function remediesOf(kind: ERunFailureKind): readonly ERunRemedy[] {
  switch (kind) {
    case ERunFailureKind.Auth:
    case ERunFailureKind.Quota:
    case ERunFailureKind.MissingCredential:
      return [ERunRemedy.FixCredential, ERunRemedy.Retry, ERunRemedy.SwitchModel]
    case ERunFailureKind.Delivery:
      return [ERunRemedy.FixCredential, ERunRemedy.Retry]
    case ERunFailureKind.RateLimited:
    case ERunFailureKind.Overloaded:
    case ERunFailureKind.ModelDenied:
      return [ERunRemedy.Retry, ERunRemedy.SwitchModel]
    case ERunFailureKind.ContextOverflow:
      return [ERunRemedy.Compact, ERunRemedy.SwitchModel]
    case ERunFailureKind.AgentFailed:
      return [ERunRemedy.OpenAgent]
    case ERunFailureKind.Network:
    case ERunFailureKind.Stalled:
    case ERunFailureKind.ExchangeFault:
    case ERunFailureKind.LoopGuard:
    case ERunFailureKind.ToolSettlement:
    case ERunFailureKind.FinishFault:
    case ERunFailureKind.Crashed:
    case ERunFailureKind.Other:
      return [ERunRemedy.Retry]
  }
}
