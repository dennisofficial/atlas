import { Module } from '@nestjs/common'
import { UserVercelController } from './user-vercel.controller'
import { UserVercelService } from './user-vercel.service'

@Module({
  controllers: [UserVercelController],
  providers: [UserVercelService],
})
export class UserVercelModule {}
