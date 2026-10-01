import { z } from 'zod'

import {
  AgentFileSystemPort,
  defaultPipeline,
  EExecutionLocation,
  EMPTY_PROMPT,
  EToolEffect,
  ProcessPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessHandle,
  type SpawnCommand,
  type ThreadId,
  type ToolDefinition,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../../channel/delta-channel'
import { PlacementController } from '../../../composition/placement-controller'
import { RoutedFileSystemPort } from '../../../execution/routed-filesystem'
import { RoutedProcessPort } from '../../../execution/routed-process'
import { HookChain } from '../../../hooks/registry'
import { buildHarness, type AtlasHarness } from '../../../loop/build-harness'
import { createTempHome, type TempHome } from '../../../loop/__tests__/temp-home'
import { scriptedModel } from '../../../model/testing/scripted-model'
import { InMemoryToolRegistry } from '../../../tools/registry'
import { TEAMMATE_AGENT_TYPE } from '../../types'
import { childRunnerSource } from '../child-runner'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, fakeRunners } from './fixtures'

export const PROJECT_DIRECTORY = '/w'

export const TEAMMATE = agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })

export enum EReachedPort {
  Process = 'process',
  Filesystem = 'filesystem',
}

export enum EHydration {
  Placement = 'placement',
  Rejecting = 'rejecting',
  Absent = 'absent',
}

export type Reached = {
  port: EReachedPort
  where: EExecutionLocation
  threadId: ThreadId | undefined
}

const closedStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })

class RecordingProcess extends ProcessPort {
  constructor(
    private readonly where: EExecutionLocation,
    private readonly reached: Reached[],
  ) {
    super()
  }

  spawn(args: SpawnCommand): ProcessHandle {
    this.reached.push({ port: EReachedPort.Process, where: this.where, threadId: args.threadId })
    return {
      stdout: closedStream(),
      stderr: closedStream(),
      exited: Promise.resolve(0),
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return null
  }
}

class RecordingFileSystem extends AgentFileSystemPort {
  constructor(
    private readonly where: EExecutionLocation,
    private readonly reached: Reached[],
  ) {
    super()
  }

  readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string> {
    this.reached.push({ port: EReachedPort.Filesystem, where: this.where, threadId: args.threadId })
    return Promise.resolve('')
  }

  private unsupported<T>(): Promise<T> {
    return Promise.reject(new Error('not exercised by this spec'))
  }

  stat(): Promise<FileStat> {
    return this.unsupported()
  }
  readLink(): Promise<string | null> {
    return this.unsupported()
  }
  readBytes(): Promise<Uint8Array> {
    return this.unsupported()
  }
  writeFile(): Promise<void> {
    return this.unsupported()
  }
  removeFile(): Promise<void> {
    return this.unsupported()
  }
  mkdir(): Promise<void> {
    return this.unsupported()
  }
  rename(): Promise<void> {
    return this.unsupported()
  }
  readDirectory(): Promise<readonly FileSystemEntry[]> {
    return this.unsupported()
  }
  glob(): Promise<readonly string[]> {
    return this.unsupported()
  }
}

export type Rig = {
  harness: AtlasHarness
  temp: TempHome
  placement: PlacementController
  bindPlacement: () => void
  reached: Reached[]
  modelCalls: () => number
  supervisorOver: (args: { hydration: EHydration }) => AgentSupervisor
  parent: ThreadId
}

export async function openRig(): Promise<Rig> {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [{ calls: [{ callId: 'call_probe', name: 'probe', input: {} }] }, { text: 'probed' }],
  })
  const harness = await buildHarness({ home: temp.home, model })

  const placement = new PlacementController(EExecutionLocation.Host)
  const bindPlacement = (): void =>
    placement.bind({ threads: harness.threads, workspace: PROJECT_DIRECTORY, repo: null })

  const reached: Reached[] = []
  const locationOf = (threadId: ThreadId | undefined): EExecutionLocation =>
    (threadId === undefined ? undefined : placement.of(threadId)) ?? placement.current()
  const processes = new RoutedProcessPort({
    local: new RecordingProcess(EExecutionLocation.Host, reached),
    docker: () => new RecordingProcess(EExecutionLocation.Docker, reached),
    locationOf,
  })
  const filesystem = new RoutedFileSystemPort({
    local: new RecordingFileSystem(EExecutionLocation.Host, reached),
    dockerFor: () => new RecordingFileSystem(EExecutionLocation.Docker, reached),
    locationOf,
  })

  const probe: ToolDefinition = {
    name: 'probe',
    description: 'touch the process and filesystem ports',
    effect: EToolEffect.Read,
    inputSchema: z.object({}),
    invoke: async ({ threadId }): Promise<ToolOutcome> => {
      processes.spawn({ cmd: ['true'], cwd: PROJECT_DIRECTORY, threadId })
      await filesystem.readFile({ path: '/w/file', threadId })
      return { ok: true, output: {}, modelText: 'probed' }
    },
  }

  const hydratorFor = (hydration: EHydration) => {
    if (hydration === EHydration.Absent) return {}
    if (hydration === EHydration.Rejecting) {
      return { hydratePlacement: () => Promise.reject(new Error('placement store unreadable')) }
    }
    return {
      hydratePlacement: async ({ threadId }: { threadId: ThreadId }) => {
        await placement.load({ threadId })
      },
    }
  }

  const supervisorOver: Rig['supervisorOver'] = ({ hydration }) =>
    new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock: harness.clock,
      agentTypes: [TEAMMATE],
      launchDirectory: PROJECT_DIRECTORY,
      runners: childRunnerSource({
        deps: () => ({
          turn: {
            log: harness.log,
            model: harness.model,
            ids: harness.ids,
            assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
            launchDirectory: PROJECT_DIRECTORY,
          },
          tools: new InMemoryToolRegistry([probe]),
          hooks: new HookChain({}),
          channel: createDeltaChannel(),
          drainNotices: async () => ({ drafts: [], wakesTurn: false }),
          assemblyFor: () =>
            defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
          ...hydratorFor(hydration),
        }),
      }),
    })

  return {
    harness,
    temp,
    placement,
    bindPlacement,
    reached,
    modelCalls: () => model.doStreamCalls.length,
    supervisorOver,
    parent: (await harness.threads.create({})).id,
  }
}

export async function stoppedDockerTeammate(rig: Rig): Promise<ThreadId> {
  const before = new AgentSupervisor({
    log: rig.harness.log,
    threads: rig.harness.threads,
    ids: rig.harness.ids,
    clock: rig.harness.clock,
    agentTypes: [TEAMMATE],
    runners: fakeRunners().source,
    launchDirectory: PROJECT_DIRECTORY,
  })
  const spawned = await before.spawn({
    threadId: rig.parent,
    agentType: TEAMMATE.name,
    brief: 'probe the environment',
    intent: 'probe',
  })
  if (!spawned.ok) throw new Error(spawned.reason)

  await rig.harness.threads.chooseExecutionLocation({
    threadId: spawned.snapshot.agentId,
    location: EExecutionLocation.Docker,
  })
  return spawned.snapshot.agentId
}
