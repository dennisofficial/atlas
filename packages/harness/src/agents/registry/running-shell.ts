import type { EKilledBy, ThreadId } from '@dltech/atlas-core'

import { EShellStatus } from '../../shells/background-shell'
import { KILL_SETTLE_MS } from '../../shells/registry-entries'
import type { ShellRegistryPort } from '../../shells/shell-registry'

const MAX_LABEL = 60

const clipped = (text: string): string =>
  text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`

export const labelOf = ({
  description,
  command,
}: {
  description: string
  command: string
}): string => clipped(description.trim() === '' ? command.trim() : description.trim())

export function runningShellOf({
  threadId,
  shells,
}: {
  threadId: ThreadId
  shells: ShellRegistryPort
}): string | undefined {
  const shell = shells.list({ threadId }).find((one) => one.status === EShellStatus.Running)
  return shell === undefined ? undefined : `bash "${labelOf(shell)}"`
}

export async function endShellsOf({
  threadId,
  by,
  shells,
}: {
  threadId: ThreadId
  by: EKilledBy
  shells: ShellRegistryPort
}): Promise<void> {
  for (const shell of shells.list({ threadId })) {
    if (shell.status === EShellStatus.Running)
      await shells.kill({ shellId: shell.shellId, by, threadId })
  }
  await shells.awaitEndings({ threadId, ms: KILL_SETTLE_MS })
}
