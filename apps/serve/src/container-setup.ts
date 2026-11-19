import { join } from 'node:path'

import { ENoticeTone, type NoticePort } from '@dltech/atlas-core'

import { runCommand, type CommandRunner } from './run-command'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'

export const CONTAINER_SETUP_MARKER = 'operational/container-setup.done'

const OUTPUT_TAIL = 2000
export const SETUP_SCRIPT_TIMEOUT_MS = 15 * 60_000
const NOTICE_KEY = 'cloud-container-setup'
export const CONTAINER_SETUP_FAILURE_KEY = 'cloud-container-setup-failed'

export enum EContainerSetupResult {
  None = 'none',
  Ran = 'ran',
  Skipped = 'skipped',
  Failed = 'failed',
}

export type ContainerSetup = (args: {
  cwd: string
  atlasHome: string
  setupScript?: string | null | undefined
  notice: NoticePort
}) => Promise<EContainerSetupResult>

const failureNoticeOf = (args: { tail: string }): string => {
  const output = args.tail === '' ? '(no output)' : args.tail
  return `The setup script failed; the sandbox started anyway. Last output:\n${output}`
}

export function createContainerSetup(args: {
  files?: WorkspaceFiles | undefined
  run?: CommandRunner | undefined
  timeoutMs?: number | undefined
}): ContainerSetup {
  const files = args.files ?? nodeWorkspaceFiles
  const run = args.run ?? runCommand
  const timeoutMs = args.timeoutMs ?? SETUP_SCRIPT_TIMEOUT_MS

  return async ({ cwd, atlasHome, setupScript, notice }) => {
    const warn = (text: string, sticky = false): void =>
      notice.notify({
        key: sticky ? CONTAINER_SETUP_FAILURE_KEY : NOTICE_KEY,
        tone: ENoticeTone.Warn,
        text,
        ...(sticky ? { ttlMs: null } : {}),
      })
    try {
      const setup = setupScript?.trim() ?? ''
      if (setup === '') return EContainerSetupResult.None

      const marker = join(atlasHome, CONTAINER_SETUP_MARKER)
      if (await files.exists(marker)) return EContainerSetupResult.Skipped

      const outcome = await run({
        command: ['sh', '-c', setup],
        cwd,
        timeoutMs,
      })
      if (!outcome.ok) {
        warn(
          failureNoticeOf({
            tail: `${outcome.stdout}${outcome.stderr}`.trim().slice(-OUTPUT_TAIL),
          }),
          true,
        )
        return EContainerSetupResult.Failed
      }
      await files.write({ path: marker, text: new Date().toISOString() })
      return EContainerSetupResult.Ran
    } catch (failure) {
      warn(
        failureNoticeOf({
          tail: failure instanceof Error ? failure.message : String(failure),
        }),
        true,
      )
      return EContainerSetupResult.Failed
    }
  }
}
