import { mock } from 'bun:test'

export type BatchItemRecord = {
  taskId: string
  payload: unknown
  idempotencyKey: string | undefined
}

export type BatchItemInput = { payload: unknown; options?: { idempotencyKey?: string } }

export type TriggerRecord = {
  taskId: string
  payload: unknown
  idempotencyKey: string | undefined
  delay: string | undefined
}

export const batchTriggerRecords: BatchItemRecord[] = []

export const triggerRecords: TriggerRecord[] = []

export const batchTrigger = mock(async (taskId: string, items: readonly BatchItemInput[]) => {
  for (const item of items) {
    batchTriggerRecords.push({
      taskId,
      payload: item.payload,
      idempotencyKey: item.options?.idempotencyKey,
    })
  }
  return { batchId: 'batch_1', runCount: items.length }
})

export const trigger = mock(
  async (
    taskId: string,
    payload: unknown,
    options?: { idempotencyKey?: string; delay?: string },
  ) => {
    triggerRecords.push({
      taskId,
      payload,
      idempotencyKey: options?.idempotencyKey,
      delay: options?.delay,
    })
    return { id: 'run_1' }
  },
)

export const idempotencyKeys = {
  create: mock(async (key: string | string[]) => (Array.isArray(key) ? key.join(':') : key)),
}

const identity = <T>(definition: T): T => definition

export const triggerSdkFake = {
  schedules: { task: identity },
  schemaTask: identity,
  concurrencyLimit: identity,
  logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  tasks: { batchTrigger, trigger },
  idempotencyKeys,
}
