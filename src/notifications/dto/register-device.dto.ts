import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { DevicePlatform } from '../../database/entities/index.js';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token from the app (FirebaseMessaging.getToken())' })
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}

export class UnregisterDeviceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4096)
  token!: string;
}
