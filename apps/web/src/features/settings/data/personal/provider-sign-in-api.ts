import type {
  AccountDto,
  EOauthProvider,
  ProviderSignInBegin,
  ProviderSignInPoll,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export const beginProviderSignIn = (provider: EOauthProvider): Promise<ProviderSignInBegin> =>
  cloudCall(api.providerSignIn.begin.mutate({ provider }))

export const completeProviderSignIn = (args: {
  attemptId: string
  code: string
}): Promise<AccountDto> => cloudCall(api.providerSignIn.complete.mutate(args))

export const pollProviderSignIn = (attemptId: string): Promise<ProviderSignInPoll> =>
  cloudCall(api.providerSignIn.poll.mutate({ attemptId }))
