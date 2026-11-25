import type { ToolPicture } from '../transcript/tool-picture'

export type WithheldToolPicture = Extract<ToolPicture, { kind: 'withheld' }>

export type ToolPictureFetch = (input: WithheldToolPicture & { sessionId: string }) => Promise<{
  mediaType: string
  data: string
}>

export const toolPictureDataUrl = (args: { mediaType: string; data: string }): string =>
  `data:${args.mediaType};base64,${args.data}`

const keyOf = (picture: WithheldToolPicture): string =>
  `${picture.threadId}:${picture.seq}:${picture.part}`

export function createToolPictureLoader(args: { fetch: ToolPictureFetch }) {
  const entries = new Map<string, Promise<string>>()

  const dataUrlOf = (picture: WithheldToolPicture & { sessionId: string }): Promise<string> => {
    const key = keyOf(picture)
    const known = entries.get(key)
    if (known !== undefined) return known
    const promise = args.fetch(picture).then(toolPictureDataUrl)
    entries.set(key, promise)
    promise.catch(() => {
      if (entries.get(key) === promise) entries.delete(key)
    })
    return promise
  }

  return { dataUrlOf }
}
