import { rawSql } from '@prisma/orm-postgres/migration'

const VERCEL_OAUTH_PENDING_TAG = 'https://vercel.com/oauth/authorize'

const copyUserServersSql = `INSERT INTO "public"."McpServer"
  ("id", "name", "source", "sealedSpec", "userId", "createdAt", "updatedAt")
SELECT "id", "name", 'cloud', "sealedSpec", "userId", "createdAt", "updatedAt"
FROM "public"."McpServerConfig"`

const copyProjectServersSql = `INSERT INTO "public"."McpServer"
  ("id", "name", "source", "sealedSpec", "projectId", "createdAt", "updatedAt")
SELECT "id", "name", 'cloud', "sealedSpec", "projectId", "createdAt", "updatedAt"
FROM "public"."ProjectMcpServer"`

const dropUnlinkedMcpPendingSql = `DELETE FROM "public"."McpOauthPending"
WHERE "serverUrl" <> '${VERCEL_OAUTH_PENDING_TAG}'`

export const copyCloudMcpServers = rawSql({
  id: 'data.mcp-server-unified-copy',
  label: 'Copy McpServerConfig and ProjectMcpServer rows into McpServer as cloud servers',
  operationClass: 'data',
  target: {
    id: 'table.McpServer',
    details: { schema: 'public', objectType: 'table' as const, name: 'McpServer' },
  },
  precheck: [],
  execute: [
    { description: 'Copy user-scoped cloud MCP servers', sql: copyUserServersSql },
    { description: 'Copy project-scoped cloud MCP servers', sql: copyProjectServersSql },
    {
      description: 'Drop in-flight MCP sign-ins, which have no server to land on',
      sql: dropUnlinkedMcpPendingSql,
    },
  ],
  postcheck: [],
})
