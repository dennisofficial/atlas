import {
  AfterToolHook,
  EStage,
  EToolEffect,
  outsideProjectNotice,
  type AfterTool,
  type HookOrder,
  type ThreadId,
} from '@dltech/atlas-core'

import { ATLAS_SESSION_DIR_ENV } from '../execution/session-environment'
import type { ThreadEnvironmentResolver } from './thread-environment'

const declaredPath = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null || !('path' in input)) return undefined
  const path = input.path
  return typeof path === 'string' ? path : undefined
}

export class OutsideProjectHook extends AfterToolHook {
  readonly name = 'outside-project'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 1 }

  constructor(
    private readonly options: { threadEnvironment?: ThreadEnvironmentResolver | undefined } = {},
  ) {
    super()
  }

  readonly run: AfterTool = async ({ call, result, projectDirectory }) => {
    if (!result.ok) return {}
    if (call.effect !== EToolEffect.Write) return {}

    const path = declaredPath(call.input)
    if (path === undefined) return {}

    const sessionDirectory = await this.sessionDirectoryOf({ threadId: call.threadId })
    const notice = outsideProjectNotice({ path, projectDirectory, sessionDirectory })
    if (notice === undefined) return {}

    return { additionalContext: notice }
  }

  private async sessionDirectoryOf({
    threadId,
  }: {
    threadId: ThreadId
  }): Promise<string | undefined> {
    try {
      const environment = await this.options.threadEnvironment?.({ threadId })
      return environment?.[ATLAS_SESSION_DIR_ENV]
    } catch {
      return undefined
    }
  }
}
