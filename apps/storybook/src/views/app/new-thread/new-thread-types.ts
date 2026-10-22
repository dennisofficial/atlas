export enum EPodProgress {
  None = 'none',
  WaitingForPod = 'waiting-for-pod',
  SettingUpWorkspace = 'setting-up-workspace',
  Ready = 'ready',
  NoVercelToken = 'no-vercel-token',
  ProvisionFailed = 'provision-failed',
}

export enum EFirstMessage {
  None = 'none',
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
}

export enum ENewThreadOutcome {
  Success = 'success',
  NoVercelToken = 'no-vercel-token',
  ProvisionFailed = 'provision-failed',
}

export function isStartingPod(pod: EPodProgress): boolean {
  return pod === EPodProgress.WaitingForPod || pod === EPodProgress.SettingUpWorkspace
}

export function isFailedPod(pod: EPodProgress): boolean {
  return pod === EPodProgress.NoVercelToken || pod === EPodProgress.ProvisionFailed
}

export function startPodOf(outcome: ENewThreadOutcome): EPodProgress {
  if (outcome === ENewThreadOutcome.NoVercelToken) return EPodProgress.NoVercelToken
  return EPodProgress.WaitingForPod
}
