export enum EPageStatus {
  Live = 'live',
  Stored = 'stored',
  Partial = 'partial',
  Mock = 'mock',
}

export type PageStatusInfo = { status: EPageStatus; detail?: string }
