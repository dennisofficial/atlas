import { Global, Module } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { JobDispatcher } from '../../_core/ports/job-dispatcher'
import { TriggerJobDispatcher } from './trigger-job-dispatcher'

@Global()
@Module({
  providers: [
    {
      provide: JobDispatcher,
      inject: [EnvService],
      useFactory: (env: EnvService): JobDispatcher =>
        new TriggerJobDispatcher({ secretKey: env.get('TRIGGER_SECRET_KEY') }),
    },
  ],
  exports: [JobDispatcher],
})
export class TriggerModule {}
