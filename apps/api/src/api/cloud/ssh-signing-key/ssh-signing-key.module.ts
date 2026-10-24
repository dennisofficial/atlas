import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { GithubModule } from '../github/github.module'
import { GithubSigningKeysClient } from './github-signing-keys.client'
import { SshSigningKeyRouter } from './ssh-signing-key.router'
import { SshSigningKeyService } from './ssh-signing-key.service'

@Module({
  imports: [GithubModule, SessionsModule],
  providers: [
    SshSigningKeyRouter,
    SshSigningKeyService,
    { provide: GithubSigningKeysClient, useFactory: () => new GithubSigningKeysClient({}) },
  ],
})
export class SshSigningKeyModule {}
