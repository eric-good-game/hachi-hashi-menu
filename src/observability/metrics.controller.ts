import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { AppEnv } from '../config/env.schema';
import { MetricsService } from './metrics.service';

/**
 * Endpoint de raspado Prometheus. Queda fuera del prefijo `/api` y no pasa por
 * autenticación: debe exponerse solo en la red interna (ver el runbook).
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject('APP_ENV') private readonly env: AppEnv,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    if (!this.env.METRICS_ENABLED) {
      throw new NotFoundException();
    }
    return this.metrics.render();
  }
}
