export enum EGithubHttpStatus {
  BadRequest = 400,
  Forbidden = 403,
  NotFound = 404,
  UpgradeRequired = 426,
  TooManyRequests = 429,
  BadGateway = 502,
  ServiceUnavailable = 503,
}

export class GithubHttpError extends Error {
  readonly status: EGithubHttpStatus

  constructor(args: { status: EGithubHttpStatus; message: string }) {
    super(args.message)
    this.name = 'GithubHttpError'
    this.status = args.status
  }
}
