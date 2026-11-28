import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'

export enum EGithubFlow {
  Idle = 'idle',
  Starting = 'starting',
  Waiting = 'waiting',
  Failed = 'failed',
}

export type GithubFlow =
  | { status: EGithubFlow.Idle }
  | { status: EGithubFlow.Starting }
  | { status: EGithubFlow.Waiting; url: string }
  | { status: EGithubFlow.Failed; message: string }

export const githubFlowOfReturn = (outcome: ReturnOutcome): GithubFlow => {
  if (outcome.result === EReturnResult.Connected) return { status: EGithubFlow.Idle }
  return {
    status: EGithubFlow.Failed,
    message: outcome.reason ?? 'GitHub access was refused',
  }
}
