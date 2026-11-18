import { ESessionStatus } from '@dltech/atlas-core'
import {
  type SessionStatusOutput,
  type SessionViewOutput,
  STREAM_SESSION_VIEW_VERSION,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

type ViewFrame = Extract<StreamServerMessage, { type: 'view' }>

const legacyStatusOf = (status: SessionStatusOutput): SessionStatusOutput =>
  status.state === ESessionStatus.StartFailed ? { ...status, state: ESessionStatus.Failed } : status

export const viewFrameOf = (args: {
  id: string
  protocolVersion: number
  view: SessionViewOutput
}): ViewFrame => {
  const { id, view } = args
  if (args.protocolVersion >= STREAM_SESSION_VIEW_VERSION) {
    return { type: 'view', id, name: 'session', at: view.at, value: view }
  }
  return { type: 'view', id, name: 'status', at: view.at, value: legacyStatusOf(view.status) }
}
