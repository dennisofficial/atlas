import { Module } from '@nestjs/common'
import { UserVercelRouter } from './user-vercel.router'
import { UserVercelService } from './user-vercel.service'

@Module({
  providers: [UserVercelRouter, UserVercelService],
})
export class UserVercelModule {}
