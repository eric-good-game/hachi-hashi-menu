import { Injectable } from '@nestjs/common';
import type { CorrelationContextPort } from '../../application/ports/system';
import { currentCorrelationId } from '../../../common/http/correlation';

@Injectable()
export class AsyncLocalStorageCorrelationContext implements CorrelationContextPort {
  correlationId(): string {
    return currentCorrelationId();
  }
}
