import { z } from 'zod'

export enum EKilledBy {
  User = 'user',
  Model = 'model',
  SessionEnd = 'session-end',
  Timeout = 'timeout',
  Rewind = 'rewind',
  ContainerSwitch = 'container-switch',
  LostContact = 'lost-contact',
  Unrecorded = 'unrecorded',
}

export enum EShellStatus {
  Running = 'running',
  Exited = 'exited',
  Killed = 'killed',
  Overflowed = 'overflowed',
}

export enum EAgentStatus {
  Running = 'running',
  Finished = 'finished',
  Failed = 'failed',
  Stopped = 'stopped',
  Blocked = 'blocked',
}

export enum EServiceStatus {
  Running = 'running',
  Exited = 'exited',
  Killed = 'killed',
}

const threadIdWireSchema = z.string().min(1).brand<'ThreadId'>()

const killedBySchema = z.enum(EKilledBy)

const portExposureSchema = z.object({
  containerPort: z.number().int().nonnegative(),
  hostPort: z.number().int().nonnegative(),
  url: z.string(),
})

export const shellSnapshotWireSchema = z.object({
  shellId: z.string().min(1).brand<'ShellId'>(),
  threadId: threadIdWireSchema,
  command: z.string(),
  description: z.string(),
  status: z.enum(EShellStatus),
  killedBy: killedBySchema.optional(),
  pid: z.number().int().optional(),
  exitCode: z.number().int().optional(),
  startedAt: z.string(),
  lastOutputAt: z.string(),
  endedAt: z.string().optional(),
  totalCharacters: z.number().int().nonnegative(),
  awaitingInput: z.boolean(),
  exposure: portExposureSchema.optional(),
})

export type ShellSnapshotWire = z.infer<typeof shellSnapshotWireSchema>

const providerIdentitySchema = z.object({ id: z.string(), modelId: z.string() })

export const agentSnapshotWireSchema = z.object({
  agentId: threadIdWireSchema,
  spawnedBy: threadIdWireSchema,
  agentType: z.string(),
  intent: z.string(),
  status: z.enum(EAgentStatus),
  killedBy: killedBySchema.optional(),
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  lastTool: z.string().nullish().transform((value) => value ?? undefined),
  startedAt: z.string(),
  steppingSince: z.string().optional(),
  endedAt: z.string().nullish().transform((value) => value ?? undefined),
  deliveredAt: z.string().optional(),
  context: z
    .object({ tokens: z.number().int().nonnegative(), window: z.number().int().nonnegative() })
    .optional(),
  model: providerIdentitySchema.optional(),
})

export type AgentSnapshotWire = z.infer<typeof agentSnapshotWireSchema>

export const serviceSnapshotWireSchema = z.object({
  serviceId: z.string().min(1),
  command: z.string(),
  description: z.string(),
  status: z.enum(EServiceStatus),
  killedBy: killedBySchema.optional(),
  pid: z.number().int().optional(),
  exitCode: z.number().int().optional(),
  logPath: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
})

export type ServiceSnapshotWire = z.infer<typeof serviceSnapshotWireSchema>

export const rosterWireSchema = z.object({
  shells: z.array(shellSnapshotWireSchema),
  agents: z.array(agentSnapshotWireSchema),
  services: z.array(serviceSnapshotWireSchema),
})

export type RosterWire = z.infer<typeof rosterWireSchema>
