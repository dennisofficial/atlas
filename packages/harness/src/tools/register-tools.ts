import {
  AgentFileSystemPort,
  carriesToolResultImages,
  DynamicToolSource,
  EventLogPort,
  FileSystemPort,
  IdPort,
  ProcessPort,
  ToolDefinition,
} from '@dltech/atlas-core'

import { AgentRegistryPort } from '../agents/registry/port'
import { withDeltaPublishing } from '../channel/publishing-event-log'
import { ExecutionLocationToken } from '../composition/execution-location-state'
import { portToken, resolveSet, type DependencyContainer } from '../container/injection'
import {
  ClientVersionToken,
  CloudSessionStoreToken,
  DeltaChannelToken,
  DockerEngineToken,
  ModelCardSourceToken,
  SecretsStoreToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
  WorkspaceRoot,
} from '../container/tokens'
import { FileWriteGuardPort } from '../files/write-guard'
import { ServiceRegistryPort } from '../services/service-registry'
import { ShellRegistryPort } from '../shells/shell-registry'
import { SkillRegistryPort } from '../skills/port'
import { ThreadStorePort } from '../store/thread-store'

import { CompositeToolRegistry } from './composite-registry'
import { AgentRegistrySourceToken, AgentTypesToken } from './builtin/agent-tokens'
import { AgentListTool } from './builtin/agent-list'
import { AgentResumeTool } from './builtin/agent-resume'
import { AgentSayTool } from './builtin/agent-say'
import { AgentSpawnTool } from './builtin/agent-spawn'
import { AgentStopTool } from './builtin/agent-stop'
import { TeammateMessageTool } from './builtin/teammate-message'
import { BashTool } from './builtin/bash'
import { EditTool } from './builtin/edit'
import { EnterWorktreeTool } from './builtin/enter-worktree'
import { ExecutionLocationTool } from './builtin/execution-location'
import { ExitWorktreeTool } from './builtin/exit-worktree'
import { GlobTool } from './builtin/glob'
import { GrepTool } from './builtin/grep'
import { McpEditTool } from './builtin/mcp-edit'
import { MultiEditTool } from './builtin/multi-edit'
import { ReadTool } from './builtin/read'
import { ServiceListTool } from './builtin/service-list'
import { ServiceStartTool } from './builtin/service-start'
import { ServiceStopTool } from './builtin/service-stop'
import { ShellKillTool } from './builtin/shell-kill'
import { ShellListTool } from './builtin/shell-list'
import { ShellOutputTool } from './builtin/shell-output'
import { SkillTool } from './builtin/skill'
import { SkillInstallTool } from './builtin/skill-install'
import { TaskWriteTool } from './builtin/task-write'
import { WebFetchTool } from './builtin/web-fetch'
import { WebSearchTool } from './builtin/web-search'
import { WriteTool } from './builtin/write'
import { WorktreeListTool } from './builtin/worktree-list'
import { InMemoryToolRegistry, ToolRegistry } from './registry'

const relocationLog = (resolver: DependencyContainer): EventLogPort => {
  const log = resolver.resolve(portToken(EventLogPort))
  if (!resolver.isRegistered(DeltaChannelToken, true)) return log
  return withDeltaPublishing({ log, channel: resolver.resolve(DeltaChannelToken) })
}

export function registerBuiltinTools({ container }: { container: DependencyContainer }): void {
  const shellRegistry = (resolver: DependencyContainer) => resolver.resolve(portToken(ShellRegistryPort))
  const serviceRegistry = (resolver: DependencyContainer) =>
    resolver.resolve(portToken(ServiceRegistryPort))
  const agentRegistry = (resolver: DependencyContainer) =>
    resolver.resolve(AgentRegistrySourceToken)

  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new ReadTool({
        files: resolver.resolve(portToken(AgentFileSystemPort)),
        carriesToolImages: resolver.isRegistered(ModelCardSourceToken, true)
          ? () => {
              const source = resolver.resolve(ModelCardSourceToken)
              return carriesToolResultImages(typeof source === 'function' ? source() : source)
            }
          : undefined,
      }),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new WriteTool(
        resolver.resolve(portToken(FileWriteGuardPort)),
        resolver.resolve(portToken(AgentFileSystemPort)),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new EditTool(
        resolver.resolve(portToken(FileWriteGuardPort)),
        resolver.resolve(portToken(AgentFileSystemPort)),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new MultiEditTool(
        resolver.resolve(portToken(FileWriteGuardPort)),
        resolver.resolve(portToken(AgentFileSystemPort)),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new BashTool(
        shellRegistry(resolver),
        resolver.resolve(portToken(FileSystemPort)),
        resolver.resolve(portToken(ProcessPort)),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new GrepTool(
        resolver.resolve(portToken(ProcessPort)),
        resolver.resolve(portToken(AgentFileSystemPort)),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new GlobTool(resolver.resolve(portToken(AgentFileSystemPort))),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ShellListTool(shellRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ShellOutputTool(shellRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ShellKillTool(shellRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new ServiceStartTool(serviceRegistry(resolver), resolver.resolve(portToken(ProcessPort))),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ServiceStopTool(serviceRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ServiceListTool(serviceRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), { useClass: TaskWriteTool })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new SkillTool(resolver.resolve(portToken(SkillRegistryPort))),
  })
  container.register(portToken(ToolDefinition), { useClass: SkillInstallTool })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new McpEditTool({
        sessions: resolver.resolve(CloudSessionStoreToken),
        clientVersion: resolver.isRegistered(ClientVersionToken, true)
          ? resolver.resolve(ClientVersionToken)
          : 'dev',
      }),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new AgentSpawnTool(
        agentRegistry(resolver),
        resolver.resolve(AgentTypesToken),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new AgentSayTool(agentRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new AgentResumeTool(agentRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new AgentListTool(agentRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new AgentStopTool(agentRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new TeammateMessageTool(agentRegistry(resolver)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new EnterWorktreeTool(
        resolver.resolve(WorkspaceRoot),
        resolver.resolve(WorktreeDirectoryToken),
      ),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ExitWorktreeTool(resolver.resolve(WorkspaceRoot)),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new ExecutionLocationTool({
        control: resolver.resolve(ExecutionLocationToken),
        engine: resolver.resolve(DockerEngineToken),
        ids: resolver.resolve(portToken(IdPort)),
        services: serviceRegistry(resolver),
        shells: shellRegistry(resolver),
        stores: () => ({
          threads: resolver.resolve(portToken(ThreadStorePort)),
          log: relocationLog(resolver),
          agents: resolver.resolve(portToken(AgentRegistryPort)),
        }),
      }),
  })
  container.register(portToken(ToolDefinition), { useClass: WorktreeListTool })
  container.register(portToken(ToolDefinition), { useClass: WebFetchTool })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new WebSearchTool(
        resolver.resolve(WebSearchBackendToken),
        resolver.resolve(SecretsStoreToken),
      ),
  })

  container.register(portToken(ToolRegistry), {
    useFactory: (resolver) =>
      new CompositeToolRegistry({
        base: new InMemoryToolRegistry(resolver.resolveAll(portToken(ToolDefinition))),
        sources: resolveSet({ container: resolver, token: portToken(DynamicToolSource) }),
      }),
  })
}
