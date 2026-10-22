import { schemaTask } from '@trigger.dev/sdk'
import { db } from '@dltech/atlas-db'
import {
  SMOKE_TASK_ID,
  type SmokeOutput,
  type SmokeTask,
  smokePayloadSchema,
} from './smoke.contract'

export interface SmokeDatabase {
  ping: () => PromiseLike<unknown>
}

const sharedDatabase: SmokeDatabase = {
  ping: () => db.execute(db.raw.sql`SELECT 1`.affectedCount().build()),
}

export async function runSmoke({
  database,
  now = () => new Date(),
}: {
  database: SmokeDatabase
  now?: () => Date
}): Promise<SmokeOutput> {
  await database.ping()
  return { ok: true, at: now().toISOString() }
}

export async function runSmokeTask(): Promise<SmokeOutput> {
  return runSmoke({ database: sharedDatabase })
}

export const smokeTask = schemaTask({
  id: SMOKE_TASK_ID,
  schema: smokePayloadSchema,
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: runSmokeTask,
}) satisfies SmokeTask
