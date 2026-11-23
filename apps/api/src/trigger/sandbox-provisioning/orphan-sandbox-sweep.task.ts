import { schedules } from '@trigger.dev/sdk'
import {
  liveSandboxNames,
  retirableSandboxNames,
} from '../../api/cloud/sandbox-provisioning/live-sandbox-names'
import type { OrphanSandboxProject } from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import { VercelOrphanSandboxStore } from '../../api/cloud/sandbox-provisioning/vercel-orphan-sandbox-store'
import { readPodsEnv, type PodsEnv } from '@dltech/atlas-pods'
import { runOrphanSweep } from './orphan-sweep-scopes'
import { triggerLog } from '../trigger-logger'

export async function storesOf(args: {
  env: Pick<PodsEnv, 'platformVercel'>
  log: (line: string) => void
}): Promise<OrphanSandboxProject[]> {
  const vercel = args.env.platformVercel
  if (vercel === null) {
    args.log('platform: PLATFORM_VERCEL_TOKEN/TEAM_ID/PROJECT_ID are not configured')
    return []
  }
  return [
    {
      label: `platform/${vercel.projectId}`,
      projectId: vercel.projectId,
      store: new VercelOrphanSandboxStore(vercel),
    },
  ]
}

export const orphanSandboxSweepTask = schedules.task({
  id: 'orphan-sandbox-sweep',
  cron: '5 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => {
    const now = new Date()
    const log = (line: string) => triggerLog.log(line)
    return runOrphanSweep({
      now,
      log,
      deps: {
        stores: () => storesOf({ env: readPodsEnv(), log }),
        liveNames: () => liveSandboxNames({ now }),
        retirableNames: () => retirableSandboxNames({ now }),
      },
    })
  },
})
