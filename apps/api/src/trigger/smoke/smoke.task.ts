import { schemaTask } from '@trigger.dev/sdk'
import { db } from '../../db'
import {
  SMOKE_TASK_ID,
  type SmokeOutput,
  type SmokeTask,
  smokePayloadSchema,
} from './smoke.contract'

export interface SmokeDatabase {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>
}

export async function runSmoke({
  database,
  now = () => new Date(),
}: {
  database: SmokeDatabase
  now?: () => Date
}): Promise<SmokeOutput> {
  await database.$queryRaw`SELECT 1`
  return { ok: true, at: now().toISOString() }
}

export async function runSmokeTask(): Promise<SmokeOutput> {
  return runSmoke({ database: db })
}

export const smokeTask = schemaTask({
  id: SMOKE_TASK_ID,
  schema: smokePayloadSchema,
  retry: { maxAttempts: 1 },
  maxDuration: 60,
  run: runSmokeTask,
}) satisfies SmokeTask
