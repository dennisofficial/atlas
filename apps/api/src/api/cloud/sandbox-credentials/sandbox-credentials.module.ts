import { Global, Module } from '@nestjs/common'
import { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { ScopedConfigModule } from '../scoped-config/scoped-config.module'
import { ScopedSandboxCredentialsService } from './scoped-sandbox-credentials.service'

@Global()
@Module({
  imports: [ScopedConfigModule],
  providers: [{ provide: SandboxCredentials, useClass: ScopedSandboxCredentialsService }],
  exports: [SandboxCredentials],
})
export class SandboxCredentialsModule {}
