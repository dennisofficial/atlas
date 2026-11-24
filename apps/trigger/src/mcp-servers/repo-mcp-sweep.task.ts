import { schedules } from '@trigger.dev/sdk'
import '../init'
import { sweepRepoMcpServers } from './repo-mcp-sweep'

export const repoMcpServerSweepTask = schedules.task({
  id: 'repo-mcp-server-sweep',
  cron: { pattern: '41 4 * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () => sweepRepoMcpServers({ now: () => new Date() }),
})
