import { mediaPathname, mediaRefSchema, type MediaRef } from '@dltech/atlas-core'
import { and, db } from '@dltech/atlas-db'
import type { PictureStore } from '@dltech/atlas-host'
import { sha256Hex, validateMediaBytes, type MediaStore } from '@dltech/atlas-media'

export type PictureRegistry = {
  find(args: { userId: string; hash: string }): Promise<MediaRef | undefined>
  insertIfAbsent(args: { userId: string; media: MediaRef }): Promise<void>
}

export class DbPictureRegistry implements PictureRegistry {
  async find(args: { userId: string; hash: string }): Promise<MediaRef | undefined> {
    const rows = await db.orm.public.Media.select('hash', 'mediaType', 'size', 'width', 'height')
      .where((m) => and(m.userId.eq(args.userId), m.hash.in([args.hash])))
      .all()
    const row = rows[0]
    return row === undefined ? undefined : mediaRefSchema.parse(row)
  }

  async insertIfAbsent(args: { userId: string; media: MediaRef }): Promise<void> {
    const { hash, mediaType, size, width, height } = args.media
    const statement = db.raw.sql`INSERT INTO "public"."Media"
      ("userId", "hash", "mediaType", "size", "width", "height")
      VALUES (${args.userId}, ${hash}, ${mediaType}, ${size}, ${width}, ${height})
      ON CONFLICT ("userId", "hash") DO NOTHING`
      .affectedCount()
      .build()
    await db.execute(statement)
  }
}

export const pictureStoreOf = (args: {
  store: MediaStore
  registry: PictureRegistry
  userId: string
}): PictureStore => ({
  async store({ bytes, signal }) {
    const checked = validateMediaBytes({ hash: sha256Hex(bytes), bytes })
    if (!checked.ok) return null
    const known = await args.registry.find({ userId: args.userId, hash: checked.media.hash })
    if (known !== undefined) return known
    await args.store.put({
      pathname: mediaPathname({ userId: args.userId, hash: checked.media.hash }),
      bytes,
      mediaType: checked.media.mediaType,
      signal,
    })
    await args.registry.insertIfAbsent({ userId: args.userId, media: checked.media })
    return checked.media
  },
})
