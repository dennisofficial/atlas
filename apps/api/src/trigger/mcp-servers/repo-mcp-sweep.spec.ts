import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it, mock } from 'bun:test'

mock.module('@trigger.dev/sdk', () => ({
  schedules: { task: <T>(definition: T): T => definition },
}))

const { REPO_MCP_SERVER_MAX_IDLE_MS, sweepRepoMcpServers } = await import('./repo-mcp-sweep')
const { repoMcpServerSweepTask } = await import('./repo-mcp-sweep.task')

const NOW = new Date('2026-11-03T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const longAgo = new Date(NOW.getTime() - REPO_MCP_SERVER_MAX_IDLE_MS - DAY_MS)
const recently = new Date(NOW.getTime() - DAY_MS)

const seedUser = async () => {
  await db.orm.public.User.create({ id: 'user-a', name: 'A', email: 'a@example.com' })
}

const seedRepo = async (args: { id: string; lastSeenAt: Date }) => {
  await db.orm.public.McpServer.create({
    id: args.id,
    name: args.id,
    source: 'repo',
    repoUrl: 'https://mcp.example.com/mcp',
    lastSeenAt: args.lastSeenAt,
    userId: 'user-a',
  })
}

const idsLeft = async () =>
  (await db.orm.public.McpServer.select('id').all()).map((row) => row.id).sort()

describe('repo MCP server sweep', () => {
  useTestDatabase()

  it('runs daily under its own id', () => {
    expect(repoMcpServerSweepTask).toMatchObject({
      id: 'repo-mcp-server-sweep',
      cron: '41 4 * * *',
    })
  })

  it('deletes repo servers unused for 30 days and keeps recent ones', async () => {
    await seedUser()
    await seedRepo({ id: 'stale', lastSeenAt: longAgo })
    await seedRepo({ id: 'fresh', lastSeenAt: recently })

    const result = await sweepRepoMcpServers({ now: () => NOW })

    expect(result).toEqual({ deleted: 1 })
    expect(await idsLeft()).toEqual(['fresh'])
  })

  it('never deletes cloud servers, however old', async () => {
    await seedUser()
    await db.orm.public.McpServer.create({
      id: 'cloud-old',
      name: 'posthog',
      source: 'cloud',
      sealedSpec: 'sealed',
      userId: 'user-a',
      createdAt: longAgo,
    })

    expect(await sweepRepoMcpServers({ now: () => NOW })).toEqual({ deleted: 0 })
    expect(await idsLeft()).toEqual(['cloud-old'])
  })
})
