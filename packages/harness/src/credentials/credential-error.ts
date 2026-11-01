export enum ECredentialFailure {
  StoreUnavailable = 'store-unavailable',
  NotFound = 'not-found',
  Unreadable = 'unreadable',
  Unsupported = 'unsupported',
  Expired = 'expired',
  RefreshFailed = 'refresh-failed',
}

export class CredentialError extends Error {
  readonly failure: ECredentialFailure
  readonly providerRefused: boolean

  constructor(args: {
    failure: ECredentialFailure
    message: string
    providerRefused?: boolean | undefined
  }) {
    super(args.message)
    this.name = 'CredentialError'
    this.failure = args.failure
    this.providerRefused = args.providerRefused === true
  }
}
