import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../../application/ports/system';

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
