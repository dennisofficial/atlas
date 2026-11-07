import type { MediaSigner } from '../media/media-signer'

export type UploadBlobs = {
  ready(): Promise<void>
  urlOf(pathname: string): Promise<string>
  sizeOf(pathname: string): Promise<number | null>
}

export const signerUploadBlobs = (signer: MediaSigner): UploadBlobs => ({
  ready: () => signer.ready(),
  urlOf: (pathname) => signer.urlOfPathname({ pathname }),
  sizeOf: (pathname) => signer.sizeOf({ pathname }),
})
