import type { PodDiskGrowDeps } from './pod-disk-grow-run'
import { failureText } from './pod-resize-run'

export const reportPodStarted = async (args: {
  deps: PodDiskGrowDeps
  sessionId: string
  diskGbFrom: number
  diskGbTo: number
}): Promise<void> => {
  try {
    await args.deps.started?.({
      sessionId: args.sessionId,
      diskGbFrom: args.diskGbFrom,
      diskGbTo: args.diskGbTo,
    })
  } catch (failure) {
    args.deps.log(
      `pod-disk-grow: reporting the restarted ${args.sessionId} failed: ${failureText(failure)}`,
    )
  }
}
