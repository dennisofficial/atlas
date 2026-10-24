import { Module } from '@nestjs/common'
import { AccountsModule } from '../accounts/accounts.module'
import { OauthConnectionsModule } from '../oauth-connections/oauth-connections.module'
import { CodexCacheRegistry } from './api-codex-ports'
import { ModelsRouter } from './models.router'
import { MODELS_FETCH, MODELS_NOW, ModelsService } from './models.service'

@Module({
  imports: [AccountsModule, OauthConnectionsModule],
  providers: [
    ModelsService,
    ModelsRouter,
    CodexCacheRegistry,
    { provide: MODELS_FETCH, useValue: (url: string, init?: RequestInit) => fetch(url, init) },
    { provide: MODELS_NOW, useValue: () => new Date().toISOString() },
  ],
})
export class ModelsModule {}
