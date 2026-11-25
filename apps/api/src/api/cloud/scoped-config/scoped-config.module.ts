import { Module } from '@nestjs/common'
import { RetiredSandboxTokenMiddleware } from '../../platform/sandboxes/retired-sandbox-token.middleware'
import { SandboxConfigRouter } from './sandbox-config.router'
import { ScopedConfigService } from './scoped-config.service'

@Module({
  providers: [ScopedConfigService, SandboxConfigRouter, RetiredSandboxTokenMiddleware],
  exports: [ScopedConfigService],
})
export class ScopedConfigModule {}
