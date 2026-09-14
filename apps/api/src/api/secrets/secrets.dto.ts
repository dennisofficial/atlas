import { IsString } from 'class-validator'

export class SetSecretDto {
  @IsString()
  value!: string
}
