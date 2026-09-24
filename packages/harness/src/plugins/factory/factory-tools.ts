import { EToolEffect, type ToolDefinition } from '@dltech/atlas-core'
import { z } from 'zod'

import { EStationKind, type FactoryClient } from './client'
import { FactoryTool } from './factory-tool'

const replySchema = z.strictObject({
  surface: z.string().min(1),
  externalId: z.string().min(1),
  body: z.string().min(1),
})

class FactoryReplyTool extends FactoryTool<typeof replySchema> {
  readonly name = 'factory_reply'
  readonly description = [
    'Post one comment to a surface of this work item as the factory app.',
    'Silence is a valid choice: reply only when the comment moves the work forward.',
    'The control plane refuses surfaces that are not aliased to the item, and rate-limits replies.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = replySchema

  protected override call({ input }: { input: z.output<typeof replySchema> }): Promise<unknown> {
    return this.client.reply(input)
  }
}

const spawnStationSchema = z.strictObject({
  kind: z.enum(EStationKind),
  message: z.string().min(1),
})

class FactorySpawnStationTool extends FactoryTool<typeof spawnStationSchema> {
  readonly name = 'factory_spawn_station'
  readonly description = [
    'Spawn a station to work on this item.',
    'The message is everything the station knows: the work item, the relevant discussion, and your instructions - it sees none of this session.',
    'Only one RW station runs at a time; steer a running one with factory_steer_station instead of spawning a second.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = spawnStationSchema

  protected override call({ input }: { input: z.output<typeof spawnStationSchema> }): Promise<unknown> {
    return this.client.spawnStation(input)
  }
}

const steerStationSchema = z.strictObject({
  runId: z.string().min(1),
  message: z.string().min(1),
})

class FactorySteerStationTool extends FactoryTool<typeof steerStationSchema> {
  readonly name = 'factory_steer_station'
  readonly description =
    'Send a message to a running station, redirecting or informing the work it is doing.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = steerStationSchema

  protected override call({ input }: { input: z.output<typeof steerStationSchema> }): Promise<unknown> {
    return this.client.steerStation(input)
  }
}

const stopStationSchema = z.strictObject({
  runId: z.string().min(1),
})

class FactoryStopStationTool extends FactoryTool<typeof stopStationSchema> {
  readonly name = 'factory_stop_station'
  readonly description = 'Stop a running station, ending its run.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = stopStationSchema

  protected override call({ input }: { input: z.output<typeof stopStationSchema> }): Promise<unknown> {
    return this.client.stopStation(input)
  }
}

const deliverSchema = z.strictObject({
  title: z.string().min(1),
  body: z.string().min(1),
})

class FactoryDeliverTool extends FactoryTool<typeof deliverSchema> {
  readonly name = 'factory_deliver'
  readonly description = [
    'Deliver the work item: the control plane re-verifies everything server-side and opens a DRAFT pull request.',
    'Never mark the pull request ready for review - that click belongs to a human.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = deliverSchema

  protected override call({ input }: { input: z.output<typeof deliverSchema> }): Promise<unknown> {
    return this.client.deliver(input)
  }
}

const submitResultSchema = z.strictObject({
  runId: z.string().min(1),
  result: z.record(z.string(), z.unknown()),
})

class FactorySubmitResultTool extends FactoryTool<typeof submitResultSchema> {
  readonly name = 'factory_submit_result'
  readonly description = [
    'Submit the result of this station run to the control plane.',
    'Call it once, when the assigned work is done; the result record carries whatever the orchestrator asked the run to produce.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = submitResultSchema

  protected override call({ input }: { input: z.output<typeof submitResultSchema> }): Promise<unknown> {
    return this.client.submitResult(input)
  }
}

const gitTokenSchema = z.strictObject({
  branch: z.string().min(1),
})

class FactoryGitTokenTool extends FactoryTool<typeof gitTokenSchema> {
  readonly name = 'factory_git_token'
  readonly description = [
    'Mint a repo-scoped installation token for git push.',
    'Only atlas-factory/* branches are accepted.',
    'The response carries the token and its expiry.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = gitTokenSchema

  protected override call({ input }: { input: z.output<typeof gitTokenSchema> }): Promise<unknown> {
    return this.client.gitToken(input)
  }
}

export const orchestratorFactoryTools = (args: {
  client: FactoryClient
}): readonly ToolDefinition[] => [
  new FactoryReplyTool(args.client),
  new FactorySpawnStationTool(args.client),
  new FactorySteerStationTool(args.client),
  new FactoryStopStationTool(args.client),
  new FactoryDeliverTool(args.client),
]

export const stationFactoryTools = (args: { client: FactoryClient }): readonly ToolDefinition[] => [
  new FactorySubmitResultTool(args.client),
  new FactoryGitTokenTool(args.client),
]
