export enum EResourceState {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export enum EResourceAction {
  Started = 'started',
  Loaded = 'loaded',
  Failed = 'failed',
}

export type TResourceAction<T> =
  | { type: EResourceAction.Started }
  | { type: EResourceAction.Loaded; data: T }
  | { type: EResourceAction.Failed }

export type IApiResourceState<T> = {
  state: EResourceState
  data: T | null
}

export const initialApiResourceState = <T>(): IApiResourceState<T> => ({
  state: EResourceState.Loading,
  data: null,
})

export const apiResourceReducer = <T>(
  current: IApiResourceState<T>,
  action: TResourceAction<T>,
): IApiResourceState<T> => {
  if (action.type === EResourceAction.Started)
    return { state: EResourceState.Loading, data: current.data }
  if (action.type === EResourceAction.Failed)
    return { state: EResourceState.Failed, data: current.data }
  return { state: EResourceState.Ready, data: action.data }
}
