import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ELoginFlow,
  providerSpec,
  type Account,
  type AccountId,
  type AccountSecret,
  type AccountStorePort,
} from '@dltech/atlas-core'

import {
  canDeviceLogin,
  canPasteLogin,
  clientFor,
  EDevicePoll,
  unsupportedProvider,
  type DeviceLogin,
  type OauthClients,
  type OauthLogin,
  type Pkce,
} from './oauth'

export type LoginTicket = { provider: EAuthProvider; url: string; pkce: Pkce }

export type DeviceTicket = { provider: EAuthProvider } & DeviceLogin

export type DeviceSignIn =
  | { status: EDevicePoll.Pending }
  | { status: EDevicePoll.Complete; account: Account }

const labelFor = (args: {
  provider: EAuthProvider
  email: string | undefined
  subscription: string | undefined
}): string => {
  if (args.email !== undefined) return args.email

  const spec = providerSpec(args.provider)
  return args.subscription === undefined ? spec.label : `${spec.label} (${args.subscription})`
}

export class AccountsService {
  private readonly accounts: AccountStorePort
  private readonly clients: OauthClients

  constructor(args: { accounts: AccountStorePort; clients: OauthClients }) {
    this.accounts = args.accounts
    this.clients = args.clients
  }

  list(): Promise<readonly Account[]> {
    return Promise.resolve(this.accounts.list())
  }

  activeFor(provider: EAuthProvider): Promise<AccountId | undefined> {
    return Promise.resolve(this.accounts.activeFor(provider))
  }

  begin(provider: EAuthProvider): LoginTicket {
    if (!providerSpec(provider).logins.includes(ELoginFlow.PastedCode))
      throw unsupportedProvider(provider)

    const client = clientFor({ clients: this.clients, provider })
    if (!canPasteLogin(client)) throw unsupportedProvider(provider)

    const pkce = client.generatePkce()

    return { provider, url: client.authorizeUrl(pkce), pkce }
  }

  async complete(args: { ticket: LoginTicket; pasted: string }): Promise<Account> {
    const client = clientFor({ clients: this.clients, provider: args.ticket.provider })
    if (!canPasteLogin(client)) throw unsupportedProvider(args.ticket.provider)

    const login = await client.exchange({ pasted: args.pasted, pkce: args.ticket.pkce })

    return this.addLogin({ provider: args.ticket.provider, login })
  }

  async beginDevice(provider: EAuthProvider): Promise<DeviceTicket> {
    if (!providerSpec(provider).logins.includes(ELoginFlow.DeviceCode))
      throw unsupportedProvider(provider)

    const client = clientFor({ clients: this.clients, provider })
    if (!canDeviceLogin(client)) throw unsupportedProvider(provider)

    return { provider, ...(await client.startDeviceLogin()) }
  }

  async pollDevice(ticket: DeviceTicket): Promise<DeviceSignIn> {
    const client = clientFor({ clients: this.clients, provider: ticket.provider })
    if (!canDeviceLogin(client)) throw unsupportedProvider(ticket.provider)

    const poll = await client.pollDeviceLogin({
      deviceAuthId: ticket.deviceAuthId,
      userCode: ticket.userCode,
    })

    if (poll.status === EDevicePoll.Pending) return poll

    return {
      status: EDevicePoll.Complete,
      account: await this.addLogin({ provider: ticket.provider, login: poll.login }),
    }
  }

  private async addLogin(args: { provider: EAuthProvider; login: OauthLogin }): Promise<Account> {
    const sameIdentity =
      args.login.email === undefined
        ? undefined
        : await this.sameEmail({ provider: args.provider, email: args.login.email })

    if (sameIdentity !== undefined) {
      return this.replaceInPlace({
        held: sameIdentity,
        secret: { kind: EAuthKind.Oauth, tokens: args.login.tokens },
      })
    }

    const added = await this.accounts.add({
      provider: args.provider,
      label: labelFor({
        provider: args.provider,
        email: args.login.email,
        subscription: args.login.subscription,
      }),
      secret: { kind: EAuthKind.Oauth, tokens: args.login.tokens },
      origin: EAccountOrigin.Login,
      ...(args.login.email === undefined ? {} : { email: args.login.email }),
      ...(args.login.subscription === undefined ? {} : { subscription: args.login.subscription }),
    })

    await this.accounts.setActive({ provider: args.provider, accountId: added.id })

    return added
  }

  private async sameEmail(args: {
    provider: EAuthProvider
    email: string
  }): Promise<Account | undefined> {
    const held = await this.accounts.list()
    return held.find(
      (account) => account.provider === args.provider && account.email === args.email,
    )
  }

  /**
   * A sign-in for an identity the vault already holds refreshes that row rather than stacking a
   * duplicate: the fresh secret lands, an expired row comes back to life, and the account id —
   * which meters and the active pointer key off — survives.
   */
  private async replaceInPlace(args: {
    held: Account
    secret: AccountSecret
  }): Promise<Account> {
    await this.accounts.replaceSecret({ accountId: args.held.id, secret: args.secret })
    if (args.held.status !== EAccountStatus.Active) {
      await this.accounts.setStatus({ accountId: args.held.id, status: EAccountStatus.Active })
    }
    await this.accounts.setActive({ provider: args.held.provider, accountId: args.held.id })

    const updated = (await this.accounts.list()).find((account) => account.id === args.held.id)
    return updated ?? { ...args.held, status: EAccountStatus.Active }
  }

  async addApiKey(args: { provider: EAuthProvider; apiKey: string }): Promise<Account> {
    const spec = providerSpec(args.provider)
    if (!spec.kinds.includes(EAuthKind.ApiKey)) throw unsupportedProvider(args.provider)

    const held = (await this.accounts.list()).find(
      (account) => account.provider === args.provider && account.kind === EAuthKind.ApiKey,
    )

    if (held !== undefined) {
      return this.replaceInPlace({
        held,
        secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey.trim() },
      })
    }

    const added = await this.accounts.add({
      provider: args.provider,
      label: `${spec.label} api key`,
      secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey.trim() },
      origin: EAccountOrigin.Login,
    })

    await this.accounts.setActive({ provider: args.provider, accountId: added.id })

    return added
  }

  /**
   * Removing the account Atlas was answering with leaves the provider pointing at nothing, so the
   * next healthiest account of the same provider takes the pointer rather than the choice being
   * silently reopened mid-session.
   */
  async remove(accountId: AccountId): Promise<void> {
    const held = (await this.accounts.list()).find((account) => account.id === accountId)
    if (held === undefined) return

    await this.accounts.remove(accountId)

    const active = await this.accounts.activeFor(held.provider)
    if (active !== undefined) return

    const successor = (await this.accounts.list()).find(
      (account) => account.provider === held.provider,
    )
    if (successor === undefined) return

    await this.accounts.setActive({ provider: held.provider, accountId: successor.id })
  }

  use(args: { provider: EAuthProvider; accountId: AccountId }): Promise<void> {
    return Promise.resolve(this.accounts.setActive(args))
  }
}
