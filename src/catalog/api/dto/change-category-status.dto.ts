import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeCategoryStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;
}
