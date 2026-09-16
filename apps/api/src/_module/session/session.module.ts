import type { DynamicModule, Type } from '@nestjs/common'
import { Global, Module } from '@nestjs/common'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import { SessionAuthGuard } from './session-auth.guard'

@Global()
@Module({})
export class SessionModule {
  static withVerifier(verifier: Type<SessionVerifier>): DynamicModule {
    return {
      module: SessionModule,
      providers: [
        { provide: SESSION_VERIFIER, useClass: verifier },
        SessionAuthGuard,
      ],
      exports: [SESSION_VERIFIER, SessionAuthGuard],
    }
  }
}
