import {
  type ChangesGcContent,
  type ChangesGcStore,
  type ChangesGcSummary,
  ControlPlane,
  runChangesGc,
} from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { schedules } from '@trigger.dev/sdk'
import type { EnvService } from '../../_core/config/env/env.service'
import { S3ChangeContentStore } from '../../_lib/changes/s3-change-content-store'
import { workerEnvService } from '../github/github-sweep-graph'

export const CHANGES_GC_TASK_ID = 'changes-gc'

export const CHANGES_GC_CRON = '*/30 * * * *'

export type ChangesGcDeps = {
  store: ChangesGcStore
  content: ChangesGcContent
  graceMs?: number | undefined
}

export const changesGcDepsOf = (env: EnvService): ChangesGcDeps => ({
  store: new ControlPlane({ store: new PostgresControlStore(db) }),
  content: new S3ChangeContentStore({ env }),
  graceMs: env.get('CHANGES_GC_GRACE_MS'),
})

export const runChangesGcTask = (deps: ChangesGcDeps): Promise<ChangesGcSummary> =>
  runChangesGc(deps)

export const changesGcTask = schedules.task({
  id: CHANGES_GC_TASK_ID,
  cron: CHANGES_GC_CRON,
  retry: { maxAttempts: 2 },
  run: async () => runChangesGcTask(changesGcDepsOf(workerEnvService())),
})
