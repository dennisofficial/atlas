import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export const MAX_PRIVATE_KEY_LENGTH = 8192

export class SigningKeyUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PRIVATE_KEY_LENGTH)
  privateKey!: string
}
