export enum ETranscriptKind {
  User = 'user',
  Agent = 'agent',
  Thought = 'thought',
  Tools = 'tools',
  Spawn = 'spawn',
  Report = 'report',
  Notice = 'notice',
  SignIn = 'sign-in',
  Request = 'request',
  Rotation = 'rotation',
}

export enum ENoticeTone {
  Ok = 'ok',
  Failed = 'failed',
  Attention = 'attention',
  Quiet = 'quiet',
}

export enum ENoticeAction {
  ChangePodSize = 'change-pod-size',
}
