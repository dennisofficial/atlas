import {
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'

import { captureDetachedPreflight } from './portable-capture'

export type DetachedLiftVerdict =
  | { ok: true }
  | { ok: false; refusal: string }

const AUTH_PROVIDERS = new Set<string>(Object.values(EAuthProvider))

export const authProviderForModelRef = (providerId: string | undefined): EAuthProvider | undefined =>
  providerId !== undefined && AUTH_PROVIDERS.has(providerId)
    ? (providerId as EAuthProvider)
    : undefined

const refusalFor = (args: { label: string; provider: EAuthProvider }): string =>
  `the account "${args.label}" the cloud session would run on is a subscription OAuth login, which cannot travel to a detached sandbox — add an API-key account for ${args.provider} (ctrl+a or /auth) and select it, then try again`

/**
 * The same selection the credential port uses (active pointer first, then freshest healthy), so a
 * provider with no active pointer but an OAuth fallback on file still refuses. A provider nobody
 * can answer for passes — the loop fails there on its own terms — and a providerId with no auth
 * provider behind it never carries a vault account.
 */
export async function detachedLiftVerdict(args: {
  providerId: string | undefined
  accounts: { list(): Promise<readonly Account[]>; activeFor(provider: EAuthProvider): Promise<AccountId | undefined> }
  home?: string | undefined
}): Promise<DetachedLiftVerdict> {
  const provider = authProviderForModelRef(args.providerId)
  if (provider === undefined) return { ok: true }

  const accounts = await args.accounts.list()
  const preferred = await args.accounts.activeFor(provider)
  const choice = chooseAccount({ accounts, provider, preferred })
  if (choice.type === EAccountChoice.Refused) return { ok: true }
  if (choice.account.kind !== EAuthKind.Oauth) return { ok: true }

  const verdict = await captureDetachedPreflight({
    selectedAccountId: choice.account.id,
    ...(args.home === undefined ? {} : { home: args.home }),
  })
  if (verdict.ok) return { ok: true }
  const label = verdict.label === 'unknown' ? choice.account.label : verdict.label
  return { ok: false, refusal: refusalFor({ label, provider }) }
}
