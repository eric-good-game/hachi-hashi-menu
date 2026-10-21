import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class ReplaceAllergensDto {
  @ApiProperty({ example: ['pescado', 'soya'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  allergenCodes!: string[];
}
