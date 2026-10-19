import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...dataSourceOptions(process.env),
        // The schema comes only from migrations (src/database/migrations), never `synchronize`,
        // which drops and re-adds columns whose type changed (losing their data). Pending
        // migrations run at start-up; the test configs run them once up front instead.
        migrationsRun: config.get<string>('DB_MIGRATIONS_RUN') !== 'false',
      }),
    }),
  ],
})
export class DatabaseModule {}
