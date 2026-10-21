import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateMenuItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 'Nigiri de salmón', minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: 'サーモン握り', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  japaneseName?: string;

  @ApiProperty({ example: 'Salmón fresco sobre arroz de sushi.' })
  @IsString()
  description!: string;

  @ApiProperty({ example: 18900, description: 'Precio en centavos' })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  priceCents!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  displayOrder!: number;
}
