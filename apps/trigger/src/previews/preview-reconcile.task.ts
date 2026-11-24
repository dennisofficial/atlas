import { schedules } from '@trigger.dev/sdk'
import { livePodSessionsIn } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { SecretCipher } from '@dltech/atlas-pods'
import { CloudflareTunnelClient, PreviewReconciler } from '@dltech/atlas-previews'
import '../init'
import { triggerLog } from '../trigger-logger'
import { readPreviewSweepDryRun, runPreviewReconcile } from './preview-reconcile'

const DEFAULT_PREVIEW_DOMAIN = 'byatlas.dev'

const required = (env: Record<string, string | undefined>, key: string): string => {
  const value = env[key]
  if (value === undefined || value === '') {
    throw new Error(
      `${key} is missing from the worker tier; the preview-reconcile task cannot reach Cloudflare without it`,
    )
  }
  return value
}

const previewReconcilerOf = (
  env: Record<string, string | undefined> = process.env,
): PreviewReconciler =>
  new PreviewReconciler({
    db,
    cipher: new SecretCipher(required(env, 'SECRETS_ENCRYPTION_KEY')),
    domain: env['PREVIEW_DOMAIN'] ?? DEFAULT_PREVIEW_DOMAIN,
    cloudflare: new CloudflareTunnelClient({
      apiToken: required(env, 'CLOUDFLARE_API_TOKEN'),
      accountId: required(env, 'CLOUDFLARE_ACCOUNT_ID'),
      zoneId: required(env, 'CLOUDFLARE_ZONE_ID'),
    }),
    livePeersOf: (podSessionId) => db.transaction((tx) => livePodSessionsIn({ tx, podSessionId })),
  })

export const previewReconcileTask = schedules.task({
  id: 'preview-reconcile',
  cron: { pattern: '*/5 * * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () =>
    runPreviewReconcile({
      deps: previewReconcilerOf(),
      log: (line) => triggerLog.log(line),
      sweepDryRun: readPreviewSweepDryRun(),
    }),
})
