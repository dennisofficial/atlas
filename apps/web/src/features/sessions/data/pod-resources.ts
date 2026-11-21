import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export type PodResizeApi = {
  command: (input: SessionCommandInput) => Promise<SessionCommandOutput>
}

export const resizePod = async (args: {
  api: PodResizeApi
  sessionId: string
  vcpus: number
  memoryGb: number
  diskGb?: number | undefined
  whenIdle: boolean
}): Promise<void> => {
  await args.api.command({
    sessionId: args.sessionId,
    name: 'resize',
    args: {
      vcpus: args.vcpus,
      memoryGb: args.memoryGb,
      ...(args.diskGb === undefined ? {} : { diskGb: args.diskGb }),
      whenIdle: args.whenIdle,
    },
  })
}
