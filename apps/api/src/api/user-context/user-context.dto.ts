import { IsString } from 'class-validator'

export class PutMemoryBundleDto {
  @IsString()
  bundle!: string
}
