import { APICallError } from '@ai-sdk/provider'
import {
  EFinishReason,
  ModelPort,
  toAccountId,
  type Assembled,
  type ModelStepResult,
  type ProviderIdentity,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../../credentials/credential-error'
import { withFailureAccount } from '../../providers/failure-account'

export const ASSEMBLED = { messages: [], instructions: [], trace: [] } as unknown as Assembled

export const REPLIED: ModelStepResult = {
  parts: [],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
}

export const providerFault = (args: { status: number; code?: string }): APICallError =>
  new APICallError({
    message: `the provider answered ${args.status}`,
    url: 'https://provider.invalid/v1/messages',
    requestBodyValues: {},
    statusCode: args.status,
    ...(args.code === undefined ? {} : { data: { error: { code: args.code } } }),
  })

export const deliveredTo = (error: APICallError): APICallError => {
  withFailureAccount({
    error,
    accountId: toAccountId('acct-1'),
    authorizationDelivered: true,
  })
  return error
}

export const authFault = (status: number): APICallError => deliveredTo(providerFault({ status }))

export const rejectedKey = (): APICallError =>
  deliveredTo(providerFault({ status: 401, code: 'invalid_api_key' }))

export const quotaFault = (): APICallError =>
  deliveredTo(providerFault({ status: 429, code: 'insufficient_quota' }))

export const credentialFault = (failure: ECredentialFailure): CredentialError =>
  new CredentialError({ failure, message: `credential ${failure}` })

export class StubModel extends ModelPort {
  readonly identity: ProviderIdentity

  public steps = 0

  private readonly fault: unknown

  constructor(args: { id: string; modelId: string; fault?: unknown }) {
    super()
    this.identity = { id: args.id, modelId: args.modelId }
    this.fault = args.fault
  }

  async step(): Promise<ModelStepResult> {
    this.steps += 1
    if (this.fault !== undefined) throw this.fault
    return REPLIED
  }
}

export const stepping = (model: ModelPort): Promise<ModelStepResult> =>
  model.step({ assembled: ASSEMBLED, tools: [], signal: new AbortController().signal })
