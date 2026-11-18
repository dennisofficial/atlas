import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'

import type { Credential, CredentialPort } from '@dltech/atlas-core'

import { withStreamProvenance } from '../stream-provenance'
import { throughACredentialTheServerAccepts } from './authorized-call'

type Authorized = { model: LanguageModelV4; credential: Credential }

export function authorizedProviderModel<TAuthorized extends Authorized>(args: {
  credentials: CredentialPort
  providerId: string
  modelId: string
  supportedUrls: LanguageModelV4['supportedUrls']
  authorize: () => Promise<TAuthorized>
  prepare: (args: {
    authorized: TAuthorized
    options: LanguageModelV4CallOptions
  }) => LanguageModelV4CallOptions
}): LanguageModelV4 {
  const through = <TResult>(call: (authorized: TAuthorized) => PromiseLike<TResult>) =>
    throughACredentialTheServerAccepts({
      credentials: args.credentials,
      providerId: args.providerId,
      modelId: args.modelId,
      authorize: args.authorize,
      call,
    })

  return {
    specificationVersion: 'v4',
    provider: args.providerId,
    modelId: args.modelId,
    supportedUrls: args.supportedUrls,
    doGenerate: (options) =>
      through((authorized) => authorized.model.doGenerate(args.prepare({ authorized, options }))),
    doStream: (options) =>
      through(async (authorized) => {
        const result = await authorized.model.doStream(args.prepare({ authorized, options }))
        return withStreamProvenance({
          result,
          provenance: {
            accountId: authorized.credential.accountId,
            providerId: args.providerId,
            modelId: args.modelId,
            authorizationDelivered: true,
          },
        })
      }),
  }
}
