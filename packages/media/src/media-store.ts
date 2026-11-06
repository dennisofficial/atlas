export type ReadDelegation = {
  delegationToken: string
  clientSigningToken: string
  validUntil: number
}

export abstract class MediaStore {
  abstract issueReadDelegation(args: { validUntil: number }): Promise<ReadDelegation>

  abstract presignGet(args: {
    delegation: ReadDelegation
    pathname: string
    validUntil: number
  }): Promise<string>

  abstract presignPut(args: {
    pathname: string
    maximumSizeInBytes: number
    validUntil: number
  }): Promise<string>

  abstract head(args: { pathname: string }): Promise<{ size: number } | null>

  abstract delete(args: { pathnames: string[] }): Promise<void>
}
