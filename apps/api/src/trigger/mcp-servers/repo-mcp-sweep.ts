import { db } from '@dltech/atlas-db'

export const REPO_MCP_SERVER_MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000

export async function sweepRepoMcpServers(args: { now: () => Date }): Promise<{ deleted: number }> {
  const before = new Date(args.now().getTime() - REPO_MCP_SERVER_MAX_IDLE_MS)
  const statement = db.raw.sql`DELETE FROM "McpServer"
      WHERE "source" = 'repo' AND "lastSeenAt" < ${before.toISOString()}::timestamptz`
    .affectedCount()
    .build()
  const { affectedRows } = await db.execute(statement)
  return { deleted: affectedRows }
}
