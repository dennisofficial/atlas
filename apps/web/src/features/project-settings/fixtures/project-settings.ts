import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { EShipBehavior } from '@dltech/atlas-wire/web'

export { EShipBehavior }

export const SHIP_BEHAVIORS: readonly {
  value: EShipBehavior
  label: string
  description: string
}[] = [
  {
    value: EShipBehavior.OpenPullRequest,
    label: 'Open pull request',
    description: 'Push a branch and open a PR for review.',
  },
  {
    value: EShipBehavior.Push,
    label: 'Push branch',
    description: 'Push the branch; you open the PR yourself.',
  },
  {
    value: EShipBehavior.Merge,
    label: 'Merge when green',
    description: 'Open a PR and squash-merge it once required checks pass.',
  },
]

export interface RepoFileStatus {
  path: string
  description: string
  present: boolean
}

export const REPO_FILES: readonly RepoFileStatus[] = [
  {
    path: '.atlas/container.json',
    description: 'Image, setup and start commands, env, and mounts for the sandbox.',
    present: true,
  },
  {
    path: '.devcontainer/devcontainer.json',
    description: 'Read for image and postCreateCommand when container.json is absent.',
    present: false,
  },
]

export interface SandboxSnapshot {
  id: string
  size: string
  cachedFor: string
  isProjectDefault: boolean
}

export const SNAPSHOTS: readonly SandboxSnapshot[] = [
  { id: 'snap_01', size: 's1.medium', cachedFor: 'Cached 6h ago', isProjectDefault: true },
  { id: 'snap_02', size: 's1.large', cachedFor: 'Cached 2d ago', isProjectDefault: false },
]

export enum ESecretScope {
  Project = 'project',
  Workspace = 'workspace',
}

export interface SecretRow {
  name: string
  value: string
  scope: ESecretScope
  updated: string
  overridesWorkspace?: boolean
}

export enum EMcpTransport {
  Stdio = 'stdio',
  Http = 'http',
}

export enum EMcpStatus {
  Connected = 'connected',
  NeedsAuth = 'needs-auth',
  Failed = 'failed',
}

export interface McpServer {
  id: string
  transport: EMcpTransport
  target: string
  status: EMcpStatus
  detail: string
  enabled: boolean
}

export interface SuggestedMcpServer {
  id: string
  name: string
  brand?: EBrand
}

export const SUGGESTED_MCP_SERVERS: readonly SuggestedMcpServer[] = [
  { id: 'sentry', name: 'Sentry', brand: EBrand.Sentry },
  { id: 'vercel', name: 'Vercel', brand: EBrand.Vercel },
  { id: 'neon', name: 'Neon', brand: EBrand.Neon },
  { id: 'stripe', name: 'Stripe', brand: EBrand.Stripe },
  { id: 'figma', name: 'Figma', brand: EBrand.Figma },
  { id: 'context7', name: 'Context7' },
]
