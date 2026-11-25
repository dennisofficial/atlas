import { Module } from '@nestjs/common'

import { CLASSIFIER_FETCH, ClassifierService } from './classifier.service'
import { ClassifierRouter } from './classifier.router'

@Module({
  providers: [
    ClassifierService,
    ClassifierRouter,
    { provide: CLASSIFIER_FETCH, useValue: (url: string, init?: RequestInit) => fetch(url, init) },
  ],
})
export class ClassifierModule {}
