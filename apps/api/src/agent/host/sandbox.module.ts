import { Global, Module, type Provider } from '@nestjs/common'

import type { ConfigSource } from '../config/agent-host-config'
import type { SandboxProviderRegistry } from '../sandbox/provider-registry'
import { sandboxResizerOf, type SandboxResizer } from '../sandbox/sandbox-resizer'
import { CONFIG_SOURCE, SANDBOX, SANDBOX_RESIZER } from './tokens'

const sandboxResizerProvider: Provider = {
  provide: SANDBOX_RESIZER,
  useFactory: (config: ConfigSource, sandbox: SandboxProviderRegistry): SandboxResizer =>
    sandboxResizerOf({ config, sandbox }),
  inject: [CONFIG_SOURCE, SANDBOX],
}

@Global()
@Module({ providers: [sandboxResizerProvider], exports: [SANDBOX_RESIZER] })
export class SandboxModule {}
