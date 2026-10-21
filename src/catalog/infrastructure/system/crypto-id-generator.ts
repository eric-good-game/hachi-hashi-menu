import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IdGeneratorPort } from '../../application/ports/system';

@Injectable()
export class CryptoIdGenerator implements IdGeneratorPort {
  uuid(): string {
    return randomUUID();
  }
}
