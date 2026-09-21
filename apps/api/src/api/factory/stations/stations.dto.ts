import { IsIn, IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator'
import { STATION_MESSAGE_CAP } from './station.types'

export class SpawnStationDto {
  @IsString()
  @IsIn(['implementer'])
  kind!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(STATION_MESSAGE_CAP)
  message!: string
}

export class SteerStationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(STATION_MESSAGE_CAP)
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
