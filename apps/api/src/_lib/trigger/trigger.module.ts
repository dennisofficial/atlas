import { Global, Module } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { JobDispatcher, JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
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
    {
      provide: JobsProjectDispatcher,
      inject: [EnvService],
      useFactory: (env: EnvService): JobsProjectDispatcher =>
        new TriggerJobDispatcher({ secretKey: env.get('TRIGGER_JOBS_SECRET_KEY') }),
    },
  ],
  exports: [JobDispatcher, JobsProjectDispatcher],
})
export class TriggerModule {}
