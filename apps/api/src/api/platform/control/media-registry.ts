import { Injectable } from '@nestjs/common'
import { mediaRefSchema, type MediaRef } from '@dltech/atlas-core'
import { and, db } from '@dltech/atlas-db'

export abstract class MediaRegistry {
  abstract find(args: { userId: string; hash: string }): Promise<MediaRef | undefined>

  abstract findMany(args: { userId: string; hashes: readonly string[] }): Promise<MediaRef[]>

  abstract insertIfAbsent(args: { userId: string; media: MediaRef }): Promise<void>
}

@Injectable()
export class DbMediaRegistry extends MediaRegistry {
  async find(args: { userId: string; hash: string }): Promise<MediaRef | undefined> {
    const rows = await this.findMany({
      userId: args.userId,
      hashes: [args.hash],
    })
    return rows[0]
  }

  async findMany(args: { userId: string; hashes: readonly string[] }): Promise<MediaRef[]> {
    if (args.hashes.length === 0) return []
    const rows = await db.orm.v2.Media.select('hash', 'mediaType', 'size', 'width', 'height')
      .where((m) => and(m.userId.eq(args.userId), m.hash.in([...args.hashes])))
      .all()
    return rows.map((row) => mediaRefSchema.parse(row))
  }

  async insertIfAbsent(args: { userId: string; media: MediaRef }): Promise<void> {
    const { hash, mediaType, size, width, height } = args.media
    const statement = db.raw.sql`INSERT INTO "v2"."Media"
      ("userId", "hash", "mediaType", "size", "width", "height")
      VALUES (${args.userId}, ${hash}, ${mediaType}, ${size}, ${width}, ${height})
      ON CONFLICT ("userId", "hash") DO NOTHING`
      .affectedCount()
      .build()
    await db.execute(statement)
  }
}
