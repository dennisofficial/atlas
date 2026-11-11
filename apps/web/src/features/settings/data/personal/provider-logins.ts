import { EProviderId } from '../../fixtures/settings-agent'
import { EAccountKind, type Account } from './accounts-api'

export type ProviderLogins = {
  logins: readonly Account[]
  activeId: string | null
}

/**
 * A provider holds any number of subscription logins; the active pointer is one of them, except when
 * it names the provider's API key instead — a key and a login are both usable, and only one of them
 * carries the pointer at a time.
 */
export function loginsOf(args: {
  accounts: readonly Account[]
  provider: EProviderId
  activeId: string | null
}): ProviderLogins {
  const logins = args.accounts.filter(
    (account) => account.provider === args.provider && account.kind === EAccountKind.Oauth,
  )
  const active = logins.find((login) => login.id === args.activeId) ?? null
  if (active === null) return { logins, activeId: null }
  return {
    logins: [active, ...logins.filter((login) => login.id !== active.id)],
    activeId: active.id,
  }
}
