import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

export class SetAvailabilityDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  available!: boolean;

  @ApiPropertyOptional({
    example: '2026-10-20T19:10:00.000Z',
    description: 'Si se omite, el servidor usa la hora actual',
  })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
