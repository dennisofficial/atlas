import {
  AfterToolHook,
  BeforeToolHook,
  BeforeTurnHook,
  ClockPort,
  PromptFragment,
  ToolDefinition,
} from '@dltech/atlas-core'

import { portToken, type DependencyContainer } from '../container/injection'
import { FileReadStatePort } from '../files/read-state'
import { LoadInstructionsHook } from '../hooks/load-instructions'
import { LoadMemoryHook } from '../hooks/load-memory'
import { NestedInstructionsHook } from '../hooks/nested-instructions'
import { StampMemoryHook } from '../hooks/stamp-memory'
import { memoryDirectoriesFor } from '../memory/read-memory'
import { MemoryFragment } from '../prompt/fragments/memory'
import type { SettingsService } from '../settings/service'
import { atlasDirectory } from '../store/paths'

import { instructionPlanOf, nestedInstructionPlanOf } from './instruction-plan'

export function bindInstructionsAndMemory(args: {
  container: DependencyContainer
  settings: SettingsService
  repoRoot: string
}): void {
  const { container, settings } = args

  container.register(portToken(BeforeTurnHook), {
    useFactory: (resolver) =>
      new LoadInstructionsHook({
        source: ({ projectDirectory }) => instructionPlanOf({ settings, projectDirectory }),
        readState: resolver.resolve(portToken(FileReadStatePort)),
      }),
  })

  container.register(portToken(AfterToolHook), {
    useFactory: (resolver) =>
      new NestedInstructionsHook({
        source: ({ projectDirectory }) => nestedInstructionPlanOf({ settings, projectDirectory }),
        tools: resolver.resolveAll(portToken(ToolDefinition)),
        readState: resolver.resolve(portToken(FileReadStatePort)),
      }),
  })

  const memoryDirectories = memoryDirectoriesFor({
    atlasHome: atlasDirectory(),
    repoRoot: args.repoRoot,
  })

  container.register(portToken(PromptFragment), {
    useValue: new MemoryFragment({ directories: memoryDirectories }),
  })

  container.register(portToken(BeforeTurnHook), {
    useFactory: (resolver) =>
      new LoadMemoryHook({
        directories: memoryDirectories,
        readState: resolver.resolve(portToken(FileReadStatePort)),
      }),
  })

  container.register(portToken(BeforeToolHook), {
    useValue: new StampMemoryHook({
      directories: [memoryDirectories.user, memoryDirectories.project],
      clock: container.resolve(portToken(ClockPort)),
    }),
  })
}
