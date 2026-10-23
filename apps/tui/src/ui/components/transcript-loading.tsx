import React from 'react'

import { ShimmerLine } from './shimmer-line'

export const LOADING_TRANSCRIPT_LABEL = 'Loading transcript…'

export const transcriptLoading = (args: {
  welcome: boolean
  bootingCloudThread: boolean
  attachFailed: boolean
  firstReadLanded: boolean
}): boolean =>
  args.welcome && args.bootingCloudThread && !args.attachFailed && !args.firstReadLanded

export function TranscriptLoading(): React.ReactNode {
  return (
    <box flexDirection="row" marginTop={1} marginBottom={1}>
      <ShimmerLine label={LOADING_TRANSCRIPT_LABEL} />
    </box>
  )
}
