import { mock } from 'bun:test'

export type BatchItemRecord = {
  taskId: string
  payload: unknown
  idempotencyKey: string | undefined
}

export type BatchItemInput = { payload: unknown; options?: { idempotencyKey?: string } }

export const batchTriggerRecords: BatchItemRecord[] = []

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

const identity = <T>(definition: T): T => definition

export const triggerSdkFake = {
  schedules: { task: identity },
  schemaTask: identity,
  concurrencyLimit: identity,
  tasks: { batchTrigger },
}
