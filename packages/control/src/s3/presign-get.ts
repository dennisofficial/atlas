const UNSAFE_IN_QUOTED_NAME = /["\\\u0000-\u001f\u007f-\uffff]/g

export const contentDispositionOf = (name: string): string =>
  `attachment; filename="${name.replace(UNSAFE_IN_QUOTED_NAME, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`

export type PresignGetOverrides = {
  ResponseContentType?: string
  ResponseContentDisposition?: string
}

export const presignGetOverridesOf = (args: {
  contentType?: string | undefined
  downloadName?: string | undefined
}): PresignGetOverrides => ({
  ...(args.contentType === undefined ? {} : { ResponseContentType: args.contentType }),
  ...(args.downloadName === undefined
    ? {}
    : { ResponseContentDisposition: contentDispositionOf(args.downloadName) }),
})
