import { BlobNotFoundError, del, get, head, issueSignedToken, presignUrl } from '@vercel/blob'

import { MediaStore, type ReadDelegation } from './media-store'

export class VercelMediaStore extends MediaStore {
  private readonly token: string

  constructor(args: { token: string }) {
    super()
    this.token = args.token
  }

  async issueReadDelegation(args: { validUntil: number }): Promise<ReadDelegation> {
    const issued = await issueSignedToken({
      token: this.token,
      pathname: '*',
      operations: ['get'],
      validUntil: args.validUntil,
    })
    return {
      delegationToken: issued.delegationToken,
      clientSigningToken: issued.clientSigningToken,
      validUntil: issued.validUntil,
    }
  }

  async presignGet(args: {
    delegation: ReadDelegation
    pathname: string
    validUntil: number
  }): Promise<string> {
    const { presignedUrl } = await presignUrl(args.delegation, {
      operation: 'get',
      pathname: args.pathname,
      access: 'private',
      validUntil: args.validUntil,
    })
    return presignedUrl
  }

  async presignPut(args: {
    pathname: string
    maximumSizeInBytes: number
    validUntil: number
  }): Promise<string> {
    const constraints = { maximumSizeInBytes: args.maximumSizeInBytes }
    const signed = await issueSignedToken({
      token: this.token,
      pathname: args.pathname,
      operations: ['put'],
      validUntil: args.validUntil,
      ...constraints,
    })
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'put',
      pathname: args.pathname,
      access: 'private',
      validUntil: args.validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...constraints,
    })
    return presignedUrl
  }

  async head(args: { pathname: string }): Promise<{ size: number } | null> {
    try {
      const found = await head(args.pathname, { token: this.token })
      return { size: found.size }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }

  async read(args: { pathname: string }): Promise<Uint8Array | null> {
    const found = await get(args.pathname, {
      access: 'private',
      token: this.token,
      useCache: false,
    })
    if (found === null || found.statusCode !== 200) return null
    return new Uint8Array(await new Response(found.stream).arrayBuffer())
  }

  async delete(args: { pathnames: string[] }): Promise<void> {
    if (args.pathnames.length === 0) return
    await del(args.pathnames, { token: this.token })
  }
}
