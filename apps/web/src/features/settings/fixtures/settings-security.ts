export enum EDeviceKind {
  Browser = 'browser',
  Cli = 'cli',
  Sandbox = 'sandbox',
}

export type SignedInDevice = {
  id: string
  kind: EDeviceKind
  name: string
  meta: string
  current: boolean
}
