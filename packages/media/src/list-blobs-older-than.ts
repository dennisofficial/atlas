import { list } from '@vercel/blob'

export async function listBlobsOlderThan(args: {
  token: string
  prefix: string
  before: Date
}): Promise<string[]> {
  const old: string[] = []
  let cursor: string | undefined
  do {
    const page = await list({
      prefix: args.prefix,
      token: args.token,
      ...(cursor === undefined ? {} : { cursor }),
    })
    for (const blob of page.blobs) {
      if (blob.uploadedAt < args.before) old.push(blob.pathname)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor !== undefined)
  return old
}
