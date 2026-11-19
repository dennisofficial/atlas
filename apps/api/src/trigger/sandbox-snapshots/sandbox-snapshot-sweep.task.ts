import { schedules } from '@trigger.dev/sdk'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { sweepAllSandboxSnapshots } from '../../api/cloud/sandbox-snapshots/sandbox-snapshot-sweep-run'
import { VercelFetcher } from '../../api/cloud/user-vercel/vercel-oauth.types'
import { VercelTokenRefresher } from '../../api/cloud/user-vercel/vercel-token-refresher'
import { workerEnvService } from '../github/github-sweep-graph'
import { triggerLog } from '../trigger-logger'

export const sandboxSnapshotSweepTask = schedules.task({
  id: 'sandbox-snapshot-sweep',
  cron: '35 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => {
    const env = workerEnvService()
    const cipher = new SecretCipherService(env)
    const result = await sweepAllSandboxSnapshots({
      tokens: new VercelTokenRefresher(cipher, env, new VercelFetcher()),
      now: () => new Date(),
      dryRun: false,
      log: (line) => triggerLog.log(line),
    })
    if (result.failures.length > 0) {
      triggerLog.error(
        `${result.failures.length} sandbox snapshot sweep failures: ${result.failures[0]}`,
      )
    }
    return result
  },
})
