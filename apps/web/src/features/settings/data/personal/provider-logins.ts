import { EProviderId } from '../../fixtures/settings-agent'
import { EAccountKind, type Account } from './accounts-api'

export type ProviderLogins = {
  logins: readonly Account[]
  activeId: string | null
}

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
