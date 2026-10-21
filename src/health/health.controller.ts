import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../catalog/infrastructure/persistence/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Salud del servicio y de su base de datos' })
  @ApiOkResponse({ description: 'Servicio operativo' })
  async check(): Promise<{ status: string; db: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', timestamp: new Date().toISOString() };
    } catch (error) {
      this.logger.error('Health check de base de datos falló', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException('Base de datos no disponible');
    }
  }
}
