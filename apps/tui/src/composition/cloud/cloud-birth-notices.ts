import { EBirthFault, EBirthNode, type BirthFailure } from '@dltech/atlas-harness'

export const CLOUD_BIRTH_NOTICE_KEY = 'container-cloud'

const FAULT_HEAD: Record<EBirthFault, string> = {
  [EBirthFault.NotConfigured]: 'cloud sandboxes are not set up',
  [EBirthFault.GitAuth]: 'git access is not set up',
  [EBirthFault.Unreachable]: 'Atlas Cloud could not be reached',
  [EBirthFault.Sandbox]: 'the sandbox would not start',
  [EBirthFault.Context]: 'the context could not reach the sandbox',
}

const FELL_BACK = 'this thread started on this machine instead'

const landing = (failure: BirthFailure): string => {
  if (failure.step === EBirthNode.Attach) {
    return `the sandbox started but could not be attached — ${FELL_BACK}`
  }
  return FELL_BACK
}

export const birthFailedNotice = (failure: BirthFailure): string =>
  `${FAULT_HEAD[failure.fault]} — ${landing(failure)}. ${failure.detail}`
