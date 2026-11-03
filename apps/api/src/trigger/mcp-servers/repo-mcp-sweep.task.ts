import { schedules } from '@trigger.dev/sdk'
import { sweepRepoMcpServers } from './repo-mcp-sweep'

export const repoMcpServerSweepTask = schedules.task({
  id: 'repo-mcp-server-sweep',
  cron: '41 4 * * *',
  retry: { maxAttempts: 3 },
  run: async () => sweepRepoMcpServers({ now: () => new Date() }),
})
