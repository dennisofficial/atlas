import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { GithubSigningKeysClient } from './github-signing-keys.client'
import { SshSigningKeyController } from './ssh-signing-key.controller'
import { SshSigningKeyService } from './ssh-signing-key.service'

@Module({
  imports: [GithubModule, SessionsModule],
  controllers: [SshSigningKeyController],
  providers: [
    SshSigningKeyService,
    { provide: GithubSigningKeysClient, useFactory: () => new GithubSigningKeysClient({}) },
  ],
})
export class SshSigningKeyModule {}
