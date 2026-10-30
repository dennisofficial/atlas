import { EEditDisposition, type PrEditPolicy } from '@dltech/atlas-core'

import type { DependencyContainer } from '../../container/injection'
import { PrEditPolicyToken } from '../../container/tokens'
import type { PrEventFrame } from '../../cloud/pr-event-frame'
import { editDispositionOfFrame } from './pull-request-provider'

export const isMutedEdit = ({
  frame,
  editPolicy,
}: {
  frame: PrEventFrame
  editPolicy: (() => PrEditPolicy) | undefined
}): boolean => editDispositionOfFrame({ frame, policy: editPolicy?.() }) === EEditDisposition.Muted

export const registeredEditPolicy = ({
  container,
}: {
  container: DependencyContainer
}): (() => PrEditPolicy) | undefined =>
  container.isRegistered(PrEditPolicyToken, true) ? container.resolve(PrEditPolicyToken) : undefined
