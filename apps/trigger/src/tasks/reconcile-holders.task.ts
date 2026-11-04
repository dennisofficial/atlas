import { schedules } from '@trigger.dev/sdk'
import {
  RECONCILE_HOLDERS_CRON,
  RECONCILE_HOLDERS_TASK_ID,
  RECONCILE_LIMIT,
} from '@dltech/atlas-jobs'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'

import { injectEncryptedTierEnv } from '../tier-env'
import { reconcileHolders } from '../reconcile/reconcile-holders'

injectEncryptedTierEnv()

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} is not set`)
  return value
}

let plane: ControlPlane | undefined
const sharedPlane = (): ControlPlane => {
  plane ??= new ControlPlane({
    store: new PostgresControlStore(createDb(createPool(requireEnv('DATABASE_URL')))),
  })
  return plane
}

export const reconcileHoldersTask = schedules.task({
  id: RECONCILE_HOLDERS_TASK_ID,
  cron: RECONCILE_HOLDERS_CRON,
  maxDuration: 60,
  run: async () => reconcileHolders({ plane: sharedPlane(), limit: RECONCILE_LIMIT }),
})
