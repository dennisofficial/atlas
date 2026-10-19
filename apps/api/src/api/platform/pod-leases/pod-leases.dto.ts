import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export const MAX_POD_TOKEN_LENGTH = 512

export class RegisterPodLeaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_POD_TOKEN_LENGTH)
  token!: string
}
