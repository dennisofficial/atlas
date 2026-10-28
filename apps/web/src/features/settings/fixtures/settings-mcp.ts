export enum EMcpTransport {
  Stdio = 'stdio',
  Http = 'http',
}

export type McpServer = {
  id: string
  transport: EMcpTransport
  target: string
  enabled: boolean
}

export const PERSONAL_MCP_SERVERS: McpServer[] = [
  {
    id: 'filesystem',
    transport: EMcpTransport.Stdio,
    target: 'npx -y @modelcontextprotocol/server-filesystem ~/Developer',
    enabled: true,
  },
  {
    id: 'context7',
    transport: EMcpTransport.Http,
    target: 'https://mcp.context7.com/mcp',
    enabled: true,
  },
  {
    id: 'playwright',
    transport: EMcpTransport.Stdio,
    target: 'npx @playwright/mcp@latest --headless',
    enabled: false,
  },
]
