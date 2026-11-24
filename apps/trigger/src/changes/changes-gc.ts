import {
  type ChangesGcContent,
  type ChangesGcStore,
  type ChangesGcSummary,
  ControlPlane,
  runChangesGc,
} from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { changesSettingsOf, S3ChangeContentStore } from '@dltech/atlas-control/s3'
import { db } from '@dltech/atlas-db'

export const CHANGES_GC_TASK_ID = 'changes-gc'

export const CHANGES_GC_CRON = '*/30 * * * *'

export type ChangesGcDeps = {
  store: ChangesGcStore
  content: ChangesGcContent
  graceMs?: number | undefined
}

export const graceMsOf = (env: Record<string, string | undefined>): number | undefined => {
  const raw = env['CHANGES_GC_GRACE_MS']
  if (raw === undefined || raw === '') return undefined
  const graceMs = Number(raw)
  if (!Number.isFinite(graceMs)) {
    throw new Error(`CHANGES_GC_GRACE_MS must be a number, got ${raw}`)
  }
  return graceMs
}

export const changesGcDepsOf = (env: Record<string, string | undefined>): ChangesGcDeps => ({
  store: new ControlPlane({ store: new PostgresControlStore(db) }),
  content: new S3ChangeContentStore({ settings: () => changesSettingsOf(env) }),
  graceMs: graceMsOf(env),
})

export const runChangesGcTask = (deps: ChangesGcDeps): Promise<ChangesGcSummary> =>
  runChangesGc(deps)
