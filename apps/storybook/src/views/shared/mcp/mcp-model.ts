import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

import {
  EMcpAuth,
  EMcpOAuthState,
  EMcpScope,
  EMcpTransport,
  type McpConnection,
  type McpServer,
  type McpSpec,
} from '../../../fixtures/settings-mcp'
import type { McpDraft } from './mcp-import'

const BRANDS: Record<string, EBrand> = {
  linear: EBrand.Linear,
  posthog: EBrand.PostHog,
  sentry: EBrand.Sentry,
  notion: EBrand.Notion,
  figma: EBrand.Figma,
  github: EBrand.GitHub,
  stripe: EBrand.Stripe,
  neon: EBrand.Neon,
  vercel: EBrand.Vercel,
}

export function brandFor(name: string): EBrand | null {
  return BRANDS[name.toLowerCase()] ?? null
}

export function targetOf(spec: McpSpec): string {
  if (spec.transport === EMcpTransport.Http) return spec.url
  return [spec.command, ...spec.args].join(' ')
}

export function usesOAuth(spec: McpSpec): boolean {
  return spec.transport === EMcpTransport.Http && spec.auth.kind === EMcpAuth.OAuth
}

export function overriddenNames(rows: readonly McpServer[]): Set<string> {
  const personal = new Set(
    rows.filter((row) => row.scope === EMcpScope.Personal).map((row) => row.name),
  )
  const project = rows.filter((row) => row.scope === EMcpScope.Project)
  return new Set(project.map((row) => row.name).filter((name) => personal.has(name)))
}

export function splitByScope(rows: readonly McpServer[]) {
  return {
    project: rows.filter((row) => row.scope === EMcpScope.Project),
    personal: rows.filter((row) => row.scope === EMcpScope.Personal),
  }
}

function connectionFor({
  spec,
  previous,
}: {
  spec: McpSpec
  previous: McpServer | undefined
}): McpConnection | null {
  if (!usesOAuth(spec)) return null
  const sameUrl =
    previous?.spec.transport === EMcpTransport.Http &&
    spec.transport === EMcpTransport.Http &&
    previous.spec.url === spec.url
  if (previous?.connection && sameUrl) return previous.connection
  return { state: EMcpOAuthState.SignInRequired }
}

export function upsertDrafts({
  rows,
  drafts,
  scope,
}: {
  rows: readonly McpServer[]
  drafts: readonly McpDraft[]
  scope: EMcpScope
}): McpServer[] {
  const next = [...rows]
  for (const draft of drafts) {
    const index = next.findIndex((row) => row.scope === scope && row.name === draft.name)
    const previous = next[index]
    const server: McpServer = {
      name: draft.name,
      scope,
      enabled: previous ? previous.enabled : draft.enabled,
      spec: draft.spec,
      connection: connectionFor({ spec: draft.spec, previous }),
    }
    if (index === -1) next.push(server)
    else next[index] = server
  }
  return next
}

export function setConnection({
  rows,
  target,
  connection,
}: {
  rows: readonly McpServer[]
  target: McpServer
  connection: McpConnection
}): McpServer[] {
  return rows.map((row) =>
    row.scope === target.scope && row.name === target.name ? { ...row, connection } : row,
  )
}

export function setEnabled({
  rows,
  target,
  enabled,
}: {
  rows: readonly McpServer[]
  target: McpServer
  enabled: boolean
}): McpServer[] {
  return rows.map((row) =>
    row.scope === target.scope && row.name === target.name ? { ...row, enabled } : row,
  )
}

export function removeServer({
  rows,
  target,
}: {
  rows: readonly McpServer[]
  target: McpServer
}): McpServer[] {
  return rows.filter((row) => !(row.scope === target.scope && row.name === target.name))
}
