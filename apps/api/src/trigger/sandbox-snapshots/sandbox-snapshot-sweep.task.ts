import { schedules } from '@trigger.dev/sdk'
import { Logger } from '@nestjs/common'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { sweepAllSandboxSnapshots } from '../../api/cloud/sandbox-snapshots/sandbox-snapshot-sweep-run'
import { workerEnvService } from '../github/github-sweep-graph'

export const sandboxSnapshotSweepTask = schedules.task({
  id: 'sandbox-snapshot-sweep',
  cron: '41 5 * * *',
  retry: { maxAttempts: 3 },
  run: async () => {
    const logger = new Logger('SandboxSnapshotSweep')
    return sweepAllSandboxSnapshots({
      cipher: new SecretCipherService(workerEnvService()),
      now: () => new Date(),
      dryRun: false,
      log: (line) => logger.log(line),
    })
  },
})
