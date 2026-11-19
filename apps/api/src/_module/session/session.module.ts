import type { DynamicModule, Provider, Type } from '@nestjs/common'
import { Global, Module } from '@nestjs/common'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import { SessionMiddleware } from './session.middleware'

@Global()
@Module({})
export class SessionModule {
  static withVerifier(verifier: Type<SessionVerifier>): DynamicModule {
    return SessionModule.around({ provide: SESSION_VERIFIER, useClass: verifier })
  }

  static withVerifierOf(verifier: SessionVerifier): DynamicModule {
    return SessionModule.around({ provide: SESSION_VERIFIER, useValue: verifier })
  }

  private static around(verifier: Provider): DynamicModule {
    return {
      module: SessionModule,
      providers: [verifier, SessionMiddleware],
      exports: [SESSION_VERIFIER, SessionMiddleware],
    }
  }
}
