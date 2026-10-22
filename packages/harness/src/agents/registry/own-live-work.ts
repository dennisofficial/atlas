import type { ThreadId } from '@dltech/atlas-core'

import { EShellStatus } from '../../shells/background-shell'
import type { ShellRegistryPort } from '../../shells/shell-registry'
import type { ServiceRegistryPort } from '../../services/service-registry-port'
import type { LiveWorkSources } from './live-work-sources'

const MAX_LABEL = 60

const clipped = (text: string): string =>
  text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`

const labelOf = ({ description, command }: { description: string; command: string }): string =>
  clipped(description.trim() === '' ? command.trim() : description.trim())

export function ownLiveWork({
  threadId,
  shells,
  services,
  sources,
}: {
  threadId: ThreadId
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  sources: LiveWorkSources
}): string | undefined {
  const shell = shells.list({ threadId }).find((one) => one.status === EShellStatus.Running)
  if (shell !== undefined) return `bash "${labelOf(shell)}"`

  const service = services.runningFor?.({ threadId })[0]
  if (service !== undefined) return `service "${labelOf(service)}"`

  return sources.reasonFor({ threadId })
}
