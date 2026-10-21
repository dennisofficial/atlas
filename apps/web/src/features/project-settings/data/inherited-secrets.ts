import type { ListedSecret } from '@/features/settings/data/workspace/resource-api'
import type { WorkspaceAccess } from '@/features/settings/data/workspace/use-workspace-access'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

export type InheritedView =
  | { state: EQueryState.Loading }
  | { state: EQueryState.Failed; message: string; retry: () => void }
  | { state: EQueryState.Ready; secrets: ListedSecret[] }

export function inheritedViewOf({
  access,
  inherited,
}: {
  access: CloudQuery<WorkspaceAccess | null>
  inherited: CloudQuery<ListedSecret[]>
}): InheritedView {
  if (access.state === EQueryState.Failed) {
    return { state: EQueryState.Failed, message: access.error.message, retry: access.reload }
  }
  if (access.state === EQueryState.Loading) return { state: EQueryState.Loading }
  if (inherited.state === EQueryState.Failed) {
    return { state: EQueryState.Failed, message: inherited.error.message, retry: inherited.reload }
  }
  if (inherited.state === EQueryState.Loading) return { state: EQueryState.Loading }
  return { state: EQueryState.Ready, secrets: inherited.data }
}
