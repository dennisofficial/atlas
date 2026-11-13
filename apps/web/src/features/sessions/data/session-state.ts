import { ESessionStatus } from '@dltech/atlas-core'
import {
  isSessionFailed,
  isSessionWorking,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { EHeaderState } from '@/features/threads/data/header-model'

export { isSessionWorking, sessionStateLineOf } from '@dltech/atlas-client/stream'

type Status = SessionSnapshot['status']

export const headerStateOfSession = (status: Status): EHeaderState => {
  if (status === undefined) return EHeaderState.Idle
  if (isSessionFailed(status)) {
    return EHeaderState.Failed
  }
  if (status.state === ESessionStatus.WaitingForCredentials) return EHeaderState.NeedsYou
  if (status.state === ESessionStatus.WaitingForOperator) return EHeaderState.NeedsYou
  return isSessionWorking(status) ? EHeaderState.Running : EHeaderState.Idle
}
