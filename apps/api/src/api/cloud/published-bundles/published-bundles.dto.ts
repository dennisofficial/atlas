import { IsDefined, IsObject, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export const MAX_PATHNAME_LENGTH = 512

export class CommitBundleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PATHNAME_LENGTH)
  pathname!: string

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  sha256!: string

  @IsDefined()
  @IsObject()
  manifest!: Record<string, unknown>
}
