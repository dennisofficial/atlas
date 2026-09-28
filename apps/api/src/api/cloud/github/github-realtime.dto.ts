import { IsInt, IsNotEmpty, IsPositive, IsString, Matches } from 'class-validator'

export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[^/\s]+\/[^/\s]+$/, { message: 'repoFullName must be owner/repo' })
  repoFullName!: string

  @IsInt()
  @IsPositive()
  prNumber!: number
}
