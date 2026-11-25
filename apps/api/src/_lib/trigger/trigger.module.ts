import { Global, Module } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { TriggerJobDispatcher } from './trigger-job-dispatcher'

@Global()
@Module({
  providers: [
    {
      provide: JobsProjectDispatcher,
      inject: [EnvService],
      useFactory: (env: EnvService): JobsProjectDispatcher =>
        new TriggerJobDispatcher({ secretKey: env.get('TRIGGER_JOBS_SECRET_KEY') }),
    },
  ],
  exports: [JobsProjectDispatcher],
})
export class TriggerModule {}
