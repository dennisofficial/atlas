import { IsIn, IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator'

const MESSAGE_MAX_LENGTH = 60_000

export class SpawnStationDto {
  @IsString()
  @IsIn(['implementer'])
  kind!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  message!: string
}

export class SteerStationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  message!: string
}

export class SubmitStationResultDto {
  @IsObject()
  result!: Record<string, unknown>
}

export class MintGitTokenDto {
  @IsString()
  @IsNotEmpty()
  branch!: string
}
