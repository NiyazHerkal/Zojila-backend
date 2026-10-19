import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service.js';

/** Global so any module can count an action without import tangles. */
@Global()
@Module({
  providers: [UsageService],
  exports: [UsageService],
})
export class AnalyticsModule {}
