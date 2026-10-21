import { EBrand } from "@dltech/atlas-ui/components/brand-mark";

export enum EMcpTransport {
  Stdio = "stdio",
  Http = "http",
}

export type McpServer = {
  id: string;
  transport: EMcpTransport;
  target: string;
  toolCount: number;
  enabled: boolean;
};

export type SuggestedMcpServer = {
  id: string;
  name: string;
  description: string;
  brand: EBrand;
};

export const PERSONAL_MCP_SERVERS: McpServer[] = [
  {
    id: "filesystem",
    transport: EMcpTransport.Stdio,
    target: "npx -y @modelcontextprotocol/server-filesystem ~/Developer",
    toolCount: 11,
    enabled: true,
  },
  {
    id: "context7",
    transport: EMcpTransport.Http,
    target: "https://mcp.context7.com/mcp",
    toolCount: 2,
    enabled: true,
  },
  {
    id: "playwright",
    transport: EMcpTransport.Stdio,
    target: "npx @playwright/mcp@latest --headless",
    toolCount: 21,
    enabled: false,
  },
];

export const WORKSPACE_MCP_SERVERS: McpServer[] = [
  {
    id: "linear",
    transport: EMcpTransport.Http,
    target: "https://mcp.linear.app/mcp",
    toolCount: 14,
    enabled: true,
  },
  {
    id: "postgres",
    transport: EMcpTransport.Stdio,
    target: "bunx @dltech/mcp-postgres --read-only",
    toolCount: 5,
    enabled: true,
  },
];

export const SUGGESTED_MCP_SERVERS: SuggestedMcpServer[] = [
  { id: "sentry", brand: EBrand.Sentry, name: "Sentry", description: "Give Atlas access to issues, events, and releases." },
  { id: "posthog", brand: EBrand.PostHog, name: "PostHog", description: "Give Atlas access to insights, flags, and session replays." },
  { id: "vercel", brand: EBrand.Vercel, name: "Vercel", description: "Give Atlas access to deployments, logs, and project settings." },
  { id: "neon", brand: EBrand.Neon, name: "Neon", description: "Give Atlas access to Postgres branches and SQL queries." },
  { id: "stripe", brand: EBrand.Stripe, name: "Stripe", description: "Give Atlas access to customers, payments, and subscriptions." },
  { id: "notion", brand: EBrand.Notion, name: "Notion", description: "Give Atlas access to pages, databases, and comments." },
];
