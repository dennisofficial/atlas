import { EExecutionLocation } from '../execution/location'

export enum ECompactScope {
  Recent = 'recent',
  Everything = 'everything',
}

export const scopeOfArgument = (argumentText: string): ECompactScope | null => {
  const asked = argumentText.trim().toLowerCase()
  if (asked === '') return ECompactScope.Recent
  if (asked === 'all') return ECompactScope.Everything
  return null
}

export const unknownScopeReason = (argumentText: string): string =>
  `/compact takes no argument, or "all" to compact the whole conversation — not ${argumentText.trim()}`

export enum EContainerAsk {
  Current = 'current',
  Resources = 'resources',
}

export const containerAskOfArgument = (
  argumentText: string,
): EExecutionLocation | EContainerAsk | null => {
  const asked = argumentText.trim().toLowerCase()
  if (asked === '') return EContainerAsk.Current
  if (asked === 'off' || asked === 'host') return EExecutionLocation.Host
  if (asked === 'docker') return EExecutionLocation.Docker
  if (asked === 'cloud') return EExecutionLocation.Cloud
  if (asked === 'resources') return EContainerAsk.Resources
  return null
}

export const unknownContainerReason = (argumentText: string): string =>
  `/container takes no argument to say where this conversation was born, "off" | "docker" to switch a host-born thread's tool environment, or "resources" to resize a cloud sandbox — threads never move to or from the cloud; not ${argumentText.trim()}`

export const instructionsOfArgument = (argumentText: string): string | undefined => {
  const trimmed = argumentText.trim()
  return trimmed === '' ? undefined : trimmed
}

export enum EMcpAsk {
  Show = 'show',
}

export type McpAsk = EMcpAsk.Show | { signIn: string }

export const mcpAskOfArgument = (argumentText: string): McpAsk | null => {
  const asked = argumentText.trim()
  if (asked.length === 0) return EMcpAsk.Show

  const signIn = asked.match(/^signin\s+(\S+)$/i)
  if (signIn?.[1] !== undefined) return { signIn: signIn[1] }

  return null
}

export const unknownMcpReason = (argumentText: string): string =>
  `/mcp takes no argument, or "signin <name>" to sign a server in — not ${argumentText.trim()}`

export const NOTHING_SAID_YET =
  '/rename has nothing to read yet — say what this conversation should be called, as in /rename Doing something cool'

export const NO_NAME_CAME_BACK =
  '/rename could not think of a name for this conversation — say one, as in /rename Doing something cool'
