import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const toNumber = ({ value }: { value: unknown }) => (value === undefined ? undefined : Number(value));
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class ListPublicItemsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ example: 'pescado,soya', description: 'Códigos separados por coma' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+(?:,[a-z0-9-]+)*$/, {
    message: 'excludeAllergens debe ser una lista de códigos separados por coma',
  })
  excludeAllergens?: string;

  @ApiPropertyOptional({ example: 'salmón', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 20;
}
