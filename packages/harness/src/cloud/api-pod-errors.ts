import { EVercelCredentialGap } from '@dltech/atlas-wire'

export enum EPodBootFailure {
  Failed = 'failed',
  TimedOut = 'timed-out',
  Cancelled = 'cancelled',
}

export class PodBootError extends Error {
  readonly kind: EPodBootFailure

  constructor(args: { kind: EPodBootFailure; message: string }) {
    super(args.message)
    this.name = 'PodBootError'
    this.kind = args.kind
  }
}

export class PodNotConfiguredError extends Error {
  readonly gap?: EVercelCredentialGap

  constructor(args: { message: string; gap?: EVercelCredentialGap | undefined }) {
    super(args.message)
    this.name = 'PodNotConfiguredError'
    if (args.gap !== undefined) this.gap = args.gap
  }
}

const GAP_HINTS: Readonly<Record<EVercelCredentialGap, string>> = {
  [EVercelCredentialGap.UserCredential]:
    'Add your Vercel credentials in your Atlas Cloud settings, then try again.',
}

const DEFAULT_NOT_CONFIGURED = 'Atlas Cloud cannot start a sandbox for this account yet.'

export const notConfiguredOf = (args: {
  error?: string | undefined
  gap?: EVercelCredentialGap | undefined
}): PodNotConfiguredError => {
  const head = args.error ?? DEFAULT_NOT_CONFIGURED
  const message = args.gap === undefined ? head : `${head} ${GAP_HINTS[args.gap]}`
  return new PodNotConfiguredError({ message, gap: args.gap })
}
