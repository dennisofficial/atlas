import { IsNotEmpty, IsString } from 'class-validator'

export class PollGithubConnectDto {
  @IsString()
  @IsNotEmpty()
  deviceCode!: string
}
