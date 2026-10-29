import React from 'react'

import { ShimmerLine } from './shimmer-line'

export const transcriptLoading = (args: {
  empty: boolean
  bootingCloudThread: boolean
  attachFailed: boolean
  firstReadLanded: boolean
}): boolean => args.empty && args.bootingCloudThread && !args.attachFailed && !args.firstReadLanded

export const loadingTranscriptLabel = (name: string | null): string =>
  name === null ? 'Opening thread' : `Opening ${name}`

export function TranscriptLoading(props: { name: string | null }): React.ReactNode {
  return (
    <box flexDirection="row" marginTop={1} marginBottom={1}>
      <ShimmerLine label={loadingTranscriptLabel(props.name)} />
    </box>
  )
}
