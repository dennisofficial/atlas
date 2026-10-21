import { ESecretKind } from '@dltech/atlas-wire/web'
import { IsEnum, IsOptional, IsString } from 'class-validator'

export class SetSecretDto {
  @IsString()
  value!: string

  @IsOptional()
  @IsEnum(ESecretKind)
  kind?: ESecretKind
}
