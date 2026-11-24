import { HEARTBEAT_TASK_ID, type HeartbeatOutput, heartbeatOutputSchema } from '@dltech/atlas-jobs'
import { schedules } from '@trigger.dev/sdk'
import './init'

export function runHeartbeat(): HeartbeatOutput {
  const output: HeartbeatOutput = {
    taskId: HEARTBEAT_TASK_ID,
    databaseUrlPresent: Boolean(process.env['DATABASE_URL']),
  }

  console.log(JSON.stringify(output))

  return heartbeatOutputSchema.parse(output)
}

export const heartbeatTask = schedules.task({
  id: HEARTBEAT_TASK_ID,
  cron: '*/15 * * * *',
  run: async () => runHeartbeat(),
})
