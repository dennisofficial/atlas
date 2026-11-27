import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { OauthLogin } from '@dltech/atlas-credentials/provider-oauth'
import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  EOauthProvider,
  type AccountDto,
  type AccountSecretDto,
  type SecretInput,
} from '@dltech/atlas-wire'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { AccountsService } from '../accounts/accounts.service'
import type { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'

export type SignInStoreDeps = {
  env: EnvService
  accounts: AccountsService
  connections: OauthConnectionsService
}

const AUTH_PROVIDER_OF: Record<EOauthProvider, EAuthProvider> = {
  [EOauthProvider.Anthropic]: EAuthProvider.Anthropic,
  [EOauthProvider.OpenAI]: EAuthProvider.OpenAI,
}

export const PROVIDER_LABEL: Record<EOauthProvider, string> = {
  [EOauthProvider.Anthropic]: 'Claude',
  [EOauthProvider.OpenAI]: 'ChatGPT',
}

const labelFor = (args: { provider: EOauthProvider; login: OauthLogin }): string => {
  if (args.login.email !== undefined) return args.login.email
  const name = PROVIDER_LABEL[args.provider]
  return args.login.subscription === undefined ? name : `${name} (${args.login.subscription})`
}

export async function storeLogin(args: {
  deps: SignInStoreDeps
  userId: string
  provider: EOauthProvider
  login: OauthLogin
}): Promise<AccountDto> {
  const connectionId = `oauth_${randomUUID()}`
  const access = await args.deps.connections.upload({
    userId: args.userId,
    connectionId,
    draft: { provider: args.provider, tokens: args.login.tokens },
  })
  const { scopes, accountId } = args.login.tokens
  const providerAccountId = access.providerAccountId ?? accountId
  const secret: SecretInput = {
    kind: EAuthKind.Oauth,
    tokens: {
      accessToken: access.accessToken,
      refreshToken: '',
      expiresAt: access.expiresAt,
      ...(scopes === undefined ? {} : { scopes }),
      ...(providerAccountId === undefined ? {} : { accountId: providerAccountId }),
    },
    authority: {
      url: args.deps.env.get('BETTER_AUTH_URL'),
      connectionId,
      authorizationId: access.authorizationId,
      generation: access.generation,
      refreshAfter: access.refreshAfter,
    },
  }
  const provider = AUTH_PROVIDER_OF[args.provider]
  const account = await replaceOrAdd({
    deps: args.deps,
    userId: args.userId,
    oauthProvider: args.provider,
    login: args.login,
    secret,
  })
  await args.deps.accounts.setActive({
    userId: args.userId,
    draft: { provider, accountId: account.id },
  })
  return account
}

async function replaceOrAdd(args: {
  deps: SignInStoreDeps
  userId: string
  oauthProvider: EOauthProvider
  login: OauthLogin
  secret: SecretInput
}): Promise<AccountDto> {
  const { accounts } = args.deps
  const provider = AUTH_PROVIDER_OF[args.oauthProvider]
  const held =
    args.login.email === undefined
      ? null
      : await db.orm.public.AgentAccount.first({
          userId: args.userId,
          provider,
          kind: EAuthKind.Oauth,
          email: args.login.email,
        })
  if (held !== null) {
    const previous = await accounts.read({
      userId: args.userId,
      accountId: held.id,
    })
    await accounts.replaceSecret({
      userId: args.userId,
      accountId: held.id,
      secret: args.secret,
    })
    await retireConnection({
      connections: args.deps.connections,
      userId: args.userId,
      secret: previous.secret,
    })
    const refreshed = await accounts.list({ userId: args.userId })
    const account = refreshed.find((candidate) => candidate.id === held.id)
    if (account !== undefined) return account
  }
  return accounts.add({
    userId: args.userId,
    draft: {
      provider,
      label: labelFor({ provider: args.oauthProvider, login: args.login }),
      origin: EAccountOrigin.Login,
      secret: args.secret,
      ...(args.login.email === undefined ? {} : { email: args.login.email }),
      ...(args.login.subscription === undefined ? {} : { subscription: args.login.subscription }),
    },
  })
}

async function retireConnection(args: {
  connections: OauthConnectionsService
  userId: string
  secret: AccountSecretDto
}): Promise<void> {
  if (args.secret.kind !== EAuthKind.Oauth || args.secret.authority === undefined) return
  await args.connections
    .remove({
      userId: args.userId,
      connectionId: args.secret.authority.connectionId,
    })
    .catch((error: unknown) => {
      if (!(error instanceof NotFoundException)) throw error
    })
}
