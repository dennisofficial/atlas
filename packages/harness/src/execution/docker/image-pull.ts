export async function consumeDaemonProgress(args: {
  response: Response
  what: string
}): Promise<void> {
  const output = await args.response.text()
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const progress: unknown = JSON.parse(line)
    if (typeof progress !== 'object' || progress === null) {
      throw new Error(`${args.what} failed: the daemon answered out of shape`)
    }
    if ('error' in progress && typeof progress.error === 'string') {
      throw new Error(`${args.what} failed: ${progress.error}`)
    }
    if (
      'errorDetail' in progress &&
      typeof progress.errorDetail === 'object' &&
      progress.errorDetail !== null &&
      'message' in progress.errorDetail &&
      typeof progress.errorDetail.message === 'string'
    ) {
      throw new Error(`${args.what} failed: ${progress.errorDetail.message}`)
    }
  }
}

export async function pullImageOrFail(args: {
  image: string
  pull: () => Promise<Response>
}): Promise<void> {
  try {
    await consumeDaemonProgress({ response: await args.pull(), what: `Pulling ${args.image}` })
  } catch (cause) {
    throw new ImagePullError({ image: args.image, cause })
  }
}

export class ImagePullError extends Error {
  readonly image: string

  constructor(args: { image: string; cause: unknown }) {
    const reason = args.cause instanceof Error ? args.cause.message : String(args.cause)
    super(
      `could not pull ${args.image} — check Docker is running and can reach ghcr.io (the image is public; no registry login is needed): ${reason}`,
      { cause: args.cause },
    )
    this.name = 'ImagePullError'
    this.image = args.image
  }
}
