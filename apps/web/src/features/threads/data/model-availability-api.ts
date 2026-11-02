import { EAuthKind, ECredentialFence } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import { ECloudControlOutcome, type CloudAvailabilityControl } from '@dltech/atlas-client/channel'

export { ECloudControlOutcome, type CloudAvailabilityControl }

export const controlCloudAvailability: CloudAvailabilityControl = async (args) => {
  const stored = await cloudCall(api.accounts.get.query({ accountId: args.key.accountId }))
  const value = stored.secretVersion ?? 0
  if (value !== args.expectedGeneration) return ECloudControlOutcome.Stale
  const refreshed = stored.secret.kind === EAuthKind.Oauth && stored.secret.authority !== undefined
  await cloudCall(
    api.credentialAvailability.control.mutate({
      key: args.key,
      revision: {
        fence: refreshed ? ECredentialFence.Refreshed : ECredentialFence.Replaced,
        value,
      },
      action: args.action,
    }),
  )
  return ECloudControlOutcome.Applied
}
