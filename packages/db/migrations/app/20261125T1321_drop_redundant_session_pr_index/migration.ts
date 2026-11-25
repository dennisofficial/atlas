#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/49cfe0bcc6c8d87db6f762e53cc306f42eda6e5e0ebde5e5aad54032999a12b9/contract';
import endContract from '../../snapshots/49cfe0bcc6c8d87db6f762e53cc306f42eda6e5e0ebde5e5aad54032999a12b9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract';
import startContract from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'SessionPullRequest',
        index: 'V2SessionPullRequest_sessionId_idx_29f415d4',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
