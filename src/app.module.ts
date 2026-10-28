import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatModule } from './chat/chat.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { FeedbackModule } from './feedback/feedback.module.js';
import { OfflineModule } from './offline/offline.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { StorageModule } from './storage/storage.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ErrorCodeFilter } from './errors/error-code.filter.js';
import { GroupsModule } from './groups/groups.module.js';
import { ItineraryModule } from './itinerary/itinerary.module.js';
import { ActivitiesModule } from './activities/activities.module.js';
import { PlacesModule } from './places/places.module.js';
import { RoutesModule } from './routes/routes.module.js';
import { SavedPlacesModule } from './saved-places/saved-places.module.js';
import { LocationModule } from './location/location.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HttpThrottlerGuard, MINUTE_MS, RATE_LIMITS } from './security/rate-limit.js';
import { StatusModule } from './status/status.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SentryModule.forRoot(),
    // Per-IP limits, in memory (one API server). Routes tighten them with @Throttle(perMinute(n)).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: MINUTE_MS, limit: RATE_LIMITS.default }],
      errorMessage: 'Too many requests. Please wait a minute and try again.',
    }),
    DatabaseModule,
    AnalyticsModule,
    RedisModule,
    AuthModule,
    GroupsModule,
    ItineraryModule,
    ActivitiesModule,
    PlacesModule,
    RoutesModule,
    SavedPlacesModule,
    RealtimeModule,
    ProfileModule,
    StatusModule,
    NotificationsModule,
    LocationModule,
    ChatModule,
    StorageModule,
    ExpensesModule,
    OfflineModule,
    PrivacyModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    // Adds a stable `code` to every error body; reports unexpected (5xx) errors to Sentry when SENTRY_DSN is set.
    { provide: APP_FILTER, useClass: ErrorCodeFilter },
  ],
})
export class AppModule {}
