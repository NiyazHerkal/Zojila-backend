import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SavePlaceDto {
  @ApiPropertyOptional({
    example: 'osm:node/795826239',
    maxLength: 200,
    description: "The place's id from nearby / search results. Leave out for a pin dropped on the map.",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  providerPlaceId?: string;

  @ApiProperty({ example: 'Hotel Snow Valley', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 32.2432 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 77.1892 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ example: 'Mall Road, Manali', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'restaurant', maxLength: 60, description: 'e.g. the nearby `kind` or search category' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  category?: string;
}
