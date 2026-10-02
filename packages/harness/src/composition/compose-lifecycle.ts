import {
  ENoticeTone,
  LogPort,
  NOTICE_WARN_MS,
  TelemetryPort,
  type NoticePort,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { disposeAll, registerDisposable } from '../container/disposal'
import { portToken, type DependencyContainer } from '../container/injection'
import { SleepPreventionToken, WakeSignalToken, WorkspaceRoot } from '../container/tokens'
import { SleepPrevention } from '../power/sleep-prevention'
import { registerBuiltinPromptFragments } from '../prompt/register-prompt-fragments'
import type { HookMishap } from '../hooks/budget'
import type { AccountUsageService } from '../usage/account-usage-service'
import { ClockJumpDetector } from '../wake/clock-jump-detector'
import { WakeSignalSource } from '../wake/wake-signal-source'
import { probeWorkspace } from '../workspace/probe'

import type { HarnessLaunch } from './config'
import { claimLaunchWorktree } from './worktree-claims'

export type LaunchWorkspace = { anchor: string; workspace: WorkspaceIdentity }

export async function claimLaunchWorkspace(args: {
  container: DependencyContainer
  launch: HarnessLaunch
}): Promise<LaunchWorkspace> {
  const anchor = args.launch.cwd ?? process.cwd()
  const workspace =
    args.launch.cwd === undefined
      ? { workspace: anchor, repo: null }
      : await probeWorkspace({ cwd: anchor })
  await claimLaunchWorktree({ container: args.container, workspace })

  return { anchor, workspace }
}

export function bindProcessServices(args: {
  container: DependencyContainer
  workspace: WorkspaceIdentity
}): void {
  const { container } = args
  registerBuiltinPromptFragments({ container })
  container.register(WorkspaceRoot, { useValue: args.workspace.workspace })
  container.register(SleepPreventionToken, {
    useValue: new SleepPrevention({ log: container.resolve(portToken(LogPort)) }),
  })

  const wakeSignals = new WakeSignalSource()
  const clockJumps = new ClockJumpDetector({})
  clockJumps.subscribe((jump) => wakeSignals.fire(jump))
  clockJumps.start()
  container.register(WakeSignalToken, { useValue: wakeSignals })
  registerDisposable({
    container,
    close: async () => {
      clockJumps.stop()
    },
  })
}

export async function closeSession(args: {
  container: DependencyContainer
  notice: NoticePort
  usage: AccountUsageService
  recordTeardownEndings: () => Promise<void>
}): Promise<void> {
  args.usage.dispose()
  await args.recordTeardownEndings().catch((error: unknown) => {
    args.notice.notify({
      tone: ENoticeTone.Warn,
      text: `Could not persist every session ending: ${error instanceof Error ? error.message : String(error)}`,
    })
  })
  await disposeAll({ container: args.container })
  await args.container.resolve(portToken(TelemetryPort)).flush()
}

export const hookMishapNotice =
  (notice: NoticePort) =>
  (mishap: HookMishap): void =>
    notice.notify({
      key: `hook:${mishap.label}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `hook ${mishap.label} ${mishap.detail}`,
    })
