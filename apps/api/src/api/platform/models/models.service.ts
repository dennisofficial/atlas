import { Inject, Injectable } from '@nestjs/common'
import { EModelProviderStatus, type ModelsResponse } from '@dltech/atlas-wire/web'
import {
  CODEX_VERSION,
  codexCatalogueFor,
  modelsView,
  OPENAI_PROVIDER_ID,
  type CodexModelsPorts,
} from '@dltech/atlas-harness/models'
import { AccountsService } from '../accounts/accounts.service'
import type { AccountDto } from '../accounts/accounts.types'
import { EAccountStatus, EAuthKind } from '../accounts/accounts.types'
import { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'
import type { AccessTokenDto } from '../oauth-connections/oauth-connections.types'
import { CodexCacheRegistry, sha256Identity } from './api-codex-ports'

export const MODELS_FETCH = Symbol('MODELS_FETCH')
export const MODELS_NOW = Symbol('MODELS_NOW')

export type ModelsAccounts = { list(args: { userId: string }): Promise<AccountDto[]> }

export type ModelsOauth = {
  activeConnection(args: {
    userId: string
    provider: string
  }): Promise<{ connectionId: string } | null>
  issueAccessToken(args: { userId: string; connectionId: string }): Promise<AccessTokenDto>
}

const holdsWorkingChatGptLogin = (accounts: readonly AccountDto[]): boolean =>
  accounts.some(
    (account) =>
      account.provider === OPENAI_PROVIDER_ID &&
      account.kind === EAuthKind.Oauth &&
      account.status !== EAccountStatus.Expired,
  )

@Injectable()
export class ModelsService {
  constructor(
    @Inject(AccountsService) private readonly accounts: ModelsAccounts,
    @Inject(OauthConnectionsService) private readonly oauth: ModelsOauth,
    @Inject(CodexCacheRegistry) private readonly caches: CodexCacheRegistry,
    @Inject(MODELS_FETCH) private readonly fetch: CodexModelsPorts['fetch'],
    @Inject(MODELS_NOW) private readonly now: () => string,
  ) {}

  async list(args: { userId: string }): Promise<ModelsResponse> {
    const held = await this.accounts.list(args)
    const live = holdsWorkingChatGptLogin(held) ? await this.liveCodex(args) : undefined
    const providers = modelsView({
      accounts: held,
      ...(live?.cards === undefined
        ? {}
        : {
            liveCards: (providerId) => (providerId === OPENAI_PROVIDER_ID ? live.cards : undefined),
          }),
    })
    return {
      providers: providers.map((provider) => ({
        ...provider,
        status:
          provider.status === 'expired'
            ? EModelProviderStatus.Expired
            : EModelProviderStatus.Connected,
      })),
      ...(live?.error === undefined ? {} : { liveError: live.error }),
    }
  }

  private async liveCodex(args: { userId: string }) {
    const connection = await this.oauth.activeConnection({
      userId: args.userId,
      provider: OPENAI_PROVIDER_ID,
    })
    if (connection === null) return undefined

    const catalogue = codexCatalogueFor({
      clientVersion: CODEX_VERSION,
      ports: {
        fetch: this.fetch,
        now: this.now,
        identityOf: sha256Identity,
        cache: this.caches.cacheFor(args.userId),
      },
      login: async () => {
        const token = await this.oauth.issueAccessToken({
          userId: args.userId,
          connectionId: connection.connectionId,
        })
        return {
          accessToken: token.accessToken,
          expiresAt: token.expiresAt,
          connectionId: connection.connectionId,
          providerAccountId: token.providerAccountId,
        }
      },
    })
    await catalogue.refresh()
    const error = catalogue.lastError()
    return error === undefined ? { cards: catalogue.cards() } : { cards: undefined, error }
  }
}
