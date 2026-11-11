import {
  AfterToolHook,
  AgentFileSystemPort,
  BeforeTurnHook,
  githubProjectOf,
  ProcessPort,
  PromptFragment,
  ToolDefinition,
} from '@dltech/atlas-core'

import { ArtifactPort } from '../artifacts/artifact-port'
import { CloudArtifactPort } from '../artifacts/cloud-artifact-port'
import { CloudMemoryPort } from '../memory/cloud-memory-port'
import { newMemoryIndexState } from '../memory/memory-index-state'
import { MemoryPort } from '../memory/memory-port'
import { readOriginIdentity } from '../memory/origin-identity'
import {
  instanceCachingFactory,
  portToken,
  registeredPortToken,
  type DependencyContainer,
} from '../container/injection'
import { ClientVersionToken, CloudSessionStoreToken, ServeSessionToken } from '../container/tokens'
import { FileReadStatePort } from '../files/read-state'
import { LoadInstructionsHook } from '../hooks/load-instructions'
import { LoadMemoryIndexHook } from '../hooks/load-memory'
import { NestedInstructionsHook } from '../hooks/nested-instructions'
import { MemoryFragment } from '../prompt/fragments/memory'
import type { SettingsService } from '../settings/service'
import { ListArtifactsTool } from '../tools/builtin/artifact-list'
import { PublishArtifactTool } from '../tools/builtin/artifact-publish'
import { PullArtifactTool } from '../tools/builtin/artifact-pull'
import { UnpublishArtifactTool } from '../tools/builtin/artifact-unpublish'
import { DeleteMemoryTool } from '../tools/builtin/memory-delete'
import { EditMemoryTool } from '../tools/builtin/memory-edit'
import { ReadMemoryTool } from '../tools/builtin/memory-read'
import { WriteMemoryTool } from '../tools/builtin/memory-write'

import { instructionPlanOf, nestedInstructionPlanOf } from './instruction-plan'

export async function bindInstructionsAndMemory(args: {
  container: DependencyContainer
  settings: SettingsService
  repoRoot: string
  repoIdentity?: string | null | undefined
}): Promise<void> {
  const { container, settings } = args

  container.register(portToken(BeforeTurnHook), {
    useFactory: (resolver) =>
      new LoadInstructionsHook({
        source: ({ projectDirectory }) => instructionPlanOf({ settings, projectDirectory }),
        readState: resolver.resolve(registeredPortToken(FileReadStatePort)),
      }),
  })

  container.register(portToken(AfterToolHook), {
    useFactory: (resolver) =>
      new NestedInstructionsHook({
        source: ({ projectDirectory }) => nestedInstructionPlanOf({ settings, projectDirectory }),
        tools: resolver.resolveAll(portToken(ToolDefinition)),
        readState: resolver.resolve(registeredPortToken(FileReadStatePort)),
      }),
  })

  const project = githubProjectOf(args.repoIdentity ?? (await readOriginIdentity(args.repoRoot)))
  const state = newMemoryIndexState()

  const session = (resolver: DependencyContainer) => () =>
    resolver.isRegistered(ServeSessionToken, true)
      ? resolver.resolve(ServeSessionToken)
      : resolver.resolve(CloudSessionStoreToken).read()

  const clientVersionOf = (resolver: DependencyContainer): string =>
    resolver.isRegistered(ClientVersionToken, true) ? resolver.resolve(ClientVersionToken) : 'dev'

  container.register(registeredPortToken(MemoryPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new CloudMemoryPort({
          project,
          clientVersion: clientVersionOf(resolver),
          session: session(resolver),
        }),
    ),
  })

  container.register(registeredPortToken(ArtifactPort), {
    useFactory: instanceCachingFactory(
      (resolver) =>
        new CloudArtifactPort({
          clientVersion: clientVersionOf(resolver),
          session: session(resolver),
        }),
    ),
  })

  container.register(portToken(PromptFragment), {
    useValue: new MemoryFragment({ state }),
  })

  container.register(portToken(BeforeTurnHook), {
    useFactory: (resolver) =>
      new LoadMemoryIndexHook({ port: resolver.resolve(registeredPortToken(MemoryPort)), state }),
  })

  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new ReadMemoryTool(resolver.resolve(registeredPortToken(MemoryPort))),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new WriteMemoryTool(resolver.resolve(registeredPortToken(MemoryPort))),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) => new EditMemoryTool(resolver.resolve(registeredPortToken(MemoryPort))),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new DeleteMemoryTool(resolver.resolve(registeredPortToken(MemoryPort))),
  })

  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new PublishArtifactTool({
        port: resolver.resolve(registeredPortToken(ArtifactPort)),
        processes: resolver.resolve(registeredPortToken(ProcessPort)),
        files: resolver.resolve(registeredPortToken(AgentFileSystemPort)),
      }),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new PullArtifactTool({
        port: resolver.resolve(registeredPortToken(ArtifactPort)),
        files: resolver.resolve(registeredPortToken(AgentFileSystemPort)),
      }),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new ListArtifactsTool(resolver.resolve(registeredPortToken(ArtifactPort))),
  })
  container.register(portToken(ToolDefinition), {
    useFactory: (resolver) =>
      new UnpublishArtifactTool(resolver.resolve(registeredPortToken(ArtifactPort))),
  })
}
