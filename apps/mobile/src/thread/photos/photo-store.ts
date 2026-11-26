export const PHOTO_STORE_LIMIT = 24

export type Photo = {
  uri: string
  name: string
  mediaType?: string | undefined
  size?: number | undefined
  width?: number | undefined
  height?: number | undefined
}

const photos = new Map<string, Photo>()
let sequence = 0

export const putPhoto = (photo: Photo): string => {
  sequence += 1
  const id = `photo-${sequence}`
  photos.set(id, photo)
  if (photos.size > PHOTO_STORE_LIMIT) {
    const oldest = photos.keys().next()
    if (!oldest.done) photos.delete(oldest.value)
  }
  return id
}

export const photoOf = (id: string | undefined): Photo | undefined =>
  id === undefined ? undefined : photos.get(id)

export const shareFileNameOf = (args: { name: string; at: number }): string =>
  `${args.at}-${args.name.replace(/[^\w.-]+/g, '_') || 'photo'}`

export const dataUriBytesOf = (uri: string): Uint8Array | undefined => {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(uri)
  if (match?.[1] === undefined) return undefined
  return Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0))
}
