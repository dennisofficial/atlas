export enum EUploadState {
  Ready = 'ready',
  Missing = 'missing',
}

export type UploadPlacement =
  | { state: EUploadState.Ready; path: string }
  | { state: EUploadState.Missing }
