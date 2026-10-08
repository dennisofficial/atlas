import { EAgentStatus, EServiceStatus, EShellStatus } from '@dltech/atlas-core'

import type { AgentSnapshot } from '../agents/registry/snapshot'
import type { ServiceSnapshot } from '../services/service-process'
import type { ShellSnapshot } from '../shells/background-shell'

export type HandoffManifest = {
  agents: readonly AgentSnapshot[]
  shells: readonly ShellSnapshot[]
  services: readonly ServiceSnapshot[]
}

export function liveManifest({
  agents,
  shells,
  services,
}: HandoffManifest): HandoffManifest {
  return {
    agents: agents.filter((agent) => agent.status === EAgentStatus.Running && agent.endedAt === undefined),
    shells: shells.filter((shell) => shell.status === EShellStatus.Running),
    services: services.filter((service) => service.status === EServiceStatus.Running),
  }
}

export function manifestSummary({ agents, shells, services }: HandoffManifest): string {
  const lines: string[] = []
  for (const agent of agents) {
    lines.push(`sub-agent ${agent.agentId} (${agent.agentType}: ${agent.intent})`)
  }
  for (const shell of shells) {
    lines.push(`background shell ${shell.shellId} ("${shell.command}")`)
  }
  for (const service of services) {
    lines.push(`service ${service.serviceId} ("${service.command}")`)
  }
  return lines.length === 0 ? 'none' : lines.join('; ')
}

function manifestBlock(manifest: HandoffManifest): string {
  const lines: string[] = ['## Runtime manifest', '']
  lines.push('Carried live at the watermark, recorded by the harness — do not re-derive from prose.')
  lines.push('')
  if (manifest.agents.length === 0 && manifest.shells.length === 0 && manifest.services.length === 0) {
    lines.push('- none')
    return lines.join('\n')
  }
  for (const agent of manifest.agents) {
    lines.push(`- agent ${agent.agentId} — type ${agent.agentType}, intent "${agent.intent}", spawned by ${agent.spawnedBy}`)
  }
  for (const shell of manifest.shells) {
    lines.push(`- shell ${shell.shellId} — "${shell.command}" (${shell.description}), owner thread ${shell.threadId}`)
  }
  for (const service of manifest.services) {
    lines.push(`- service ${service.serviceId} — "${service.command}" (${service.description})`)
  }
  return lines.join('\n')
}

export function successorSeedText(args: {
  instructions: string
  handoffPath: string
  manifest: HandoffManifest
  operationId: string
}): string {
  const { instructions, handoffPath, manifest, operationId } = args
  return [
    `This session was rotated forward (operation ${operationId}). You are the successor main agent;`,
    'the predecessor retired at the watermark recorded in session meta. Your handoff note lives at',
    handoffPath,
    '',
    instructions.trim().length === 0
      ? 'The operator gave no further instructions — continue from the handoff.'
      : `The operator's instructions: ${instructions}`,
    '',
    `Carried live work: ${manifestSummary(manifest)}.`,
  ].join('\n')
}

export function renderHandoff(args: {
  narrative: string
  instructions: string
  manifest: HandoffManifest
  predecessor: string
  successor: string
  watermarkSeq: number
  skills?: readonly string[] | undefined
  artifacts?: readonly string[] | undefined
}): string {
  const sections: string[] = [
    `# Rotation handoff`,
    '',
    `Predecessor ${args.predecessor} hands this session to ${args.successor} at watermark seq ${args.watermarkSeq}.`,
    '',
    `## Operator instructions (verbatim)`,
    '',
    args.instructions.trim().length === 0 ? '(none given)' : args.instructions,
    '',
    `## Narrative`,
    '',
    args.narrative,
    '',
  ]
  if (args.skills !== undefined && args.skills.length > 0) {
    sections.push(`## Suggested skills`, '', ...args.skills.map((skill) => `- ${skill}`), '')
  }
  if (args.artifacts !== undefined && args.artifacts.length > 0) {
    sections.push(`## Artifact references`, '', ...args.artifacts.map((artifact) => `- ${artifact}`), '')
  }
  sections.push(manifestBlock(args.manifest), '')
  return sections.join('\n')
}
