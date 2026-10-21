import {
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/auth/auth.guard';
import { DevToolsGuard } from '../../common/auth/dev-tools.guard';
import { Roles, RolesGuard } from '../../common/auth/roles.guard';
import { AVAILABILITY_INBOUND, CLOCK, ID_GENERATOR } from '../catalog.tokens';
import type { ClockPort, IdGeneratorPort } from '../application/ports/system';
import type {
  AvailabilityChangeStatus,
  AvailabilityInboundPort,
} from '../application/ports/availability-inbound';
import { SetAvailabilityDto } from './dto/set-availability.dto';

export interface AvailabilitySimulationResponse {
  menuItemId: string;
  available: boolean;
  occurredAt: string;
  status: AvailabilityChangeStatus;
}

/**
 * Simulador de Inventory para la etapa A. No existe cuando
 * DEV_TOOLS_ENABLED=false (modo integrado).
 */
@ApiTags('dev')
@ApiBearerAuth()
@Controller('menu/dev')
@UseGuards(DevToolsGuard, AuthGuard, RolesGuard)
@Roles('admin')
export class DevAvailabilityController {
  constructor(
    @Inject(AVAILABILITY_INBOUND) private readonly applyAvailability: AvailabilityInboundPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  @Put('items/:id/availability')
  @ApiOperation({ summary: 'Simula MenuItemAvailabilityChanged desde Inventory (solo etapa A)' })
  @ApiOkResponse({ description: 'Disponibilidad procesada; status indica si se aplicó, era duplicada o vieja' })
  async setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AvailabilitySimulationResponse> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : this.clock.now();
    const result = await this.applyAvailability.execute({
      messageId: this.ids.uuid(),
      menuItemId: id,
      available: dto.available,
      occurredAt,
    });

    if (result.status === 'unknown') {
      throw new NotFoundException('Platillo no encontrado');
    }

    return {
      menuItemId: id,
      available: dto.available,
      occurredAt: occurredAt.toISOString(),
      status: result.status,
    };
  }
}
