import { secretOf, type Credential, type CredentialPort } from '@dltech/atlas-core'

import { isConfirmedAuthRefusal } from '../auth-repair'
import { failingAs, withFailureAccount } from '../failure-account'

export async function throughACredentialTheServerAccepts<
  TAuthorized extends { credential: Credential },
  TResult,
>(args: {
  credentials: CredentialPort
  providerId: string
  modelId: string
  authorize: () => Promise<TAuthorized>
  call: (authorized: TAuthorized) => PromiseLike<TResult>
}): Promise<TResult> {
  const provenanceOf = (credential: Credential) => ({
    accountId: credential.accountId,
    providerId: args.providerId,
    modelId: args.modelId,
    authorizationDelivered: true,
  })

  const authorized = await args.authorize()

  try {
    return await args.call(authorized)
  } catch (error) {
    withFailureAccount({ error, ...provenanceOf(authorized.credential) })
    if (!isConfirmedAuthRefusal(error)) throw error

    await args.credentials.discard(authorized.credential)

    const retried = await args.authorize()
    if (secretOf(retried.credential) === secretOf(authorized.credential)) throw error

    return await failingAs({
      ...provenanceOf(retried.credential),
      run: () => args.call(retried),
    })
  }
}
