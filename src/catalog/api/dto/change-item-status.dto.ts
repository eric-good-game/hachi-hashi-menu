import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';

export class ChangeItemStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  revision!: number;
}
