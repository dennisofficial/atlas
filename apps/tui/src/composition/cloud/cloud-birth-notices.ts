import { EBirthFault, EBirthNode, type BirthFailure } from '@dltech/atlas-harness'

export const CLOUD_BIRTH_NOTICE_KEY = 'container-cloud'

const FAULT_HEAD: Record<EBirthFault, string> = {
  [EBirthFault.NotConfigured]: 'cloud sandboxes are not set up',
  [EBirthFault.Unreachable]: 'Atlas Cloud could not be reached',
  [EBirthFault.Sandbox]: 'the pod would not start',
  [EBirthFault.Context]: 'the context could not reach the pod',
  [EBirthFault.ImagePull]: 'the pod image could not be pulled',
}

const landing = (failure: BirthFailure): string =>
  failure.step === EBirthNode.Attach ? ' — the pod started but could not be attached' : ''

export const birthFailedNotice = (failure: BirthFailure): string =>
  `${FAULT_HEAD[failure.fault]}${landing(failure)}. ${failure.detail}`

export const BIRTH_CANCELLED_NOTICE = 'starting the pod was cancelled — send again to retry'
