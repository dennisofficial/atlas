import { schedules } from '@trigger.dev/sdk'
import '../init'
import { composerUploadSweepStoreOf, sweepComposerUploads } from './composer-upload-sweep'

export const composerUploadSweepTask = schedules.task({
  id: 'composer-upload-sweep',
  cron: { pattern: '17 4 * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () =>
    sweepComposerUploads({
      store: composerUploadSweepStoreOf(process.env),
      now: () => new Date(),
    }),
})
