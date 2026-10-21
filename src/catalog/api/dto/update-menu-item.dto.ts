import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class UpdateMenuItemDto {
  @ApiProperty({ example: 1, minimum: 1, description: 'Revisión actual del platillo' })
  @IsInt()
  @Min(1)
  revision!: number;

  @ApiPropertyOptional({ example: 'Nigiri de salmón', minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'サーモン握り', maxLength: 120, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  japaneseName?: string | null;

  @ApiPropertyOptional({ example: 'Salmón fresco sobre arroz de sushi.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ example: 19900, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  priceCents?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 20, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
