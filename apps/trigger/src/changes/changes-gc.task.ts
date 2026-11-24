import { schedules } from '@trigger.dev/sdk'
import '../init'
import {
  CHANGES_GC_CRON,
  CHANGES_GC_TASK_ID,
  changesGcDepsOf,
  runChangesGcTask,
} from './changes-gc'
import { contextFilesGcDepsOf, runContextFilesGcTask } from './context-files-gc'

export const changesGcTask = schedules.task({
  id: CHANGES_GC_TASK_ID,
  cron: { pattern: CHANGES_GC_CRON, window: '0m' },
  retry: { maxAttempts: 2 },
  run: async () => {
    const changes = await runChangesGcTask(changesGcDepsOf(process.env))
    const contextFiles = await runContextFilesGcTask(contextFilesGcDepsOf(process.env))
    return { changes, contextFiles }
  },
})
