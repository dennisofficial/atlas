export type OperatorInputRequestView = {
  requestId: string
  description: string
  url?: string | undefined
}

export type OperatorInputReady = {
  kind: 'awaiting'
  request: OperatorInputRequestView
  typed: string
  failure: string | null
}

export type OperatorInputState =
  | OperatorInputReady
  | { kind: 'delivering'; request: OperatorInputRequestView; typed: string }
