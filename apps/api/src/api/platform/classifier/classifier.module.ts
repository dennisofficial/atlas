import { Module } from '@nestjs/common'

import { SessionsModule } from '../sessions/sessions.module'
import { CLASSIFIER_FETCH, ClassifierService } from './classifier.service'
import { ClassifierRouter } from './classifier.router'

@Module({
  imports: [SessionsModule],
  providers: [
    ClassifierService,
    ClassifierRouter,
    { provide: CLASSIFIER_FETCH, useValue: (url: string, init?: RequestInit) => fetch(url, init) },
  ],
})
export class ClassifierModule {}
