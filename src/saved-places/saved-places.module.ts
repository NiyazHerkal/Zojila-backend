import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { SavedPlace } from '../database/entities/index.js';
import { SavedPlacesController } from './saved-places.controller.js';
import { SavedPlacesService } from './saved-places.service.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([SavedPlace])],
  controllers: [SavedPlacesController],
  providers: [SavedPlacesService],
})
export class SavedPlacesModule {}
