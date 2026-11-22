import { Module } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipher, sessionNamerOf, type SessionNamer } from '../../../agent'
import { EnvService } from '../../../_core/config/env/env.service'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { SESSION_NAMER, ThreadTitlingService } from './thread-titling.service'

@Module({
  imports: [SessionsModule],
  providers: [
    ThreadTitlingService,
    {
      provide: SESSION_NAMER,
      useFactory: (env: EnvService): SessionNamer =>
        sessionNamerOf({ db, cipher: new SecretCipher(env.get('SECRETS_ENCRYPTION_KEY')) }),
      inject: [EnvService],
    },
  ],
  exports: [ThreadTitlingService],
})
export class ThreadTitlingModule {}
