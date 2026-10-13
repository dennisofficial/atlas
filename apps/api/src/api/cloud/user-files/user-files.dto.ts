import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import { USER_FILE_TREES, type UserFileTree } from './user-files.types'

export const MAX_PATHS_PER_GET = 500

export class ListUserFilesQuery {
  @IsIn(USER_FILE_TREES)
  tree!: UserFileTree

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sinceRevision?: number
}

export class StreamUserFilesQuery {
  @IsOptional()
  @IsIn(USER_FILE_TREES)
  tree?: UserFileTree
}

export class GetUserFilesDto {
  @IsIn(USER_FILE_TREES)
  tree!: UserFileTree

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_PATHS_PER_GET)
  @IsString({ each: true })
  paths!: string[]
}

export class PutUserFileDto {
  @IsString()
  content!: string

  @IsString()
  contentHash!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  baseRevision?: number
}

export class DeleteUserFileDto {
  @IsInt()
  @Min(0)
  baseRevision!: number
}
