#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract';
import endContract from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract.json' with { type: 'json' };
import startContract from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { dropOperations } from './drop-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return dropOperations();
  }
}

MigrationCLI.run(import.meta.url, M);
