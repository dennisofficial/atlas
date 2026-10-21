import type { CloudQuery } from '@/lib/use-cloud-query'
import { EQueryState } from '@/lib/use-cloud-query'

export function combineGeneralQueries<TDetails, TSettings, TData>({
  details,
  settings,
  reload,
  build,
}: {
  details: CloudQuery<TDetails>
  settings: CloudQuery<TSettings>
  reload: () => void
  build: (args: { details: TDetails; settings: TSettings }) => TData
}): CloudQuery<TData> {
  if (details.state === EQueryState.Failed) return { ...details, reload }
  if (settings.state === EQueryState.Failed) return { ...settings, reload }
  if (details.state !== EQueryState.Ready || settings.state !== EQueryState.Ready) {
    return { state: EQueryState.Loading, data: undefined, error: undefined, reload }
  }
  return {
    state: EQueryState.Ready,
    data: build({ details: details.data, settings: settings.data }),
    error: undefined,
    reload,
  }
}
