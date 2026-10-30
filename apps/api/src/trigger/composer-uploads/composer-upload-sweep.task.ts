import { schedules } from '@trigger.dev/sdk'
import { VercelComposerUploadBlobStore } from '../../api/cloud/composer-uploads/vercel-composer-upload-blob-store'
import { workerEnvService } from '../github/github-sweep-graph'
import { sweepComposerUploads } from './composer-upload-sweep'

export const composerUploadSweepTask = schedules.task({
  id: 'composer-upload-sweep',
  cron: '17 4 * * *',
  retry: { maxAttempts: 3 },
  run: async () =>
    sweepComposerUploads({
      store: new VercelComposerUploadBlobStore(workerEnvService()),
      now: () => new Date(),
    }),
})
