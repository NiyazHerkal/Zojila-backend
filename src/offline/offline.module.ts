import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { ItineraryModule } from '../itinerary/itinerary.module.js';
import { StatusModule } from '../status/status.module.js';
import { OfflineController } from './offline.controller.js';
import { OfflineService } from './offline.service.js';

/** Phase 11 (PDF §2.8): the offline trip bundle. */
@Module({
  imports: [AuthModule, GroupsModule, ItineraryModule, ActivitiesModule, StatusModule, ExpensesModule, ChatModule],
  controllers: [OfflineController],
  providers: [OfflineService],
})
export class OfflineModule {}
