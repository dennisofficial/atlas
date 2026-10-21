export enum ENewThreadStage {
  Draft = "draft",
  Empty = "empty",
  WaitingForPod = "waiting-for-pod",
  SettingUpWorkspace = "setting-up-workspace",
  Streaming = "streaming",
  Idle = "idle",
  NoVercelToken = "no-vercel-token",
  ProvisionFailed = "provision-failed",
}

export enum ENewThreadOutcome {
  Success = "success",
  NoVercelToken = "no-vercel-token",
  ProvisionFailed = "provision-failed",
}

export function isProvisioningStage(stage: ENewThreadStage): boolean {
  return stage === ENewThreadStage.WaitingForPod || stage === ENewThreadStage.SettingUpWorkspace;
}

export function isFailureStage(stage: ENewThreadStage): boolean {
  return stage === ENewThreadStage.NoVercelToken || stage === ENewThreadStage.ProvisionFailed;
}

export function startStageOf(outcome: ENewThreadOutcome): ENewThreadStage {
  if (outcome === ENewThreadOutcome.NoVercelToken) return ENewThreadStage.NoVercelToken;
  return ENewThreadStage.WaitingForPod;
}

interface NextStageInput {
  stage: ENewThreadStage;
  outcome: ENewThreadOutcome;
}

export function nextStage({ stage, outcome }: NextStageInput): ENewThreadStage {
  if (stage === ENewThreadStage.WaitingForPod) {
    return outcome === ENewThreadOutcome.ProvisionFailed
      ? ENewThreadStage.ProvisionFailed
      : ENewThreadStage.SettingUpWorkspace;
  }
  if (stage === ENewThreadStage.SettingUpWorkspace) return ENewThreadStage.Streaming;
  return stage;
}
