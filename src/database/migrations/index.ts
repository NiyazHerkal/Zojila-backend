import { Baseline1791187931142 } from './1791187931142-Baseline.js';
import { TimestampsWithTimeZone1791190000000 } from './1791190000000-TimestampsWithTimeZone.js';
import { FeedbackAndUsage1791190100000 } from './1791190100000-FeedbackAndUsage.js';
import { ExpensePayments1791196010867 } from './1791196010867-ExpensePayments.js';
import { ActivityProgressAndUpdates1791197583046 } from './1791197583046-ActivityProgressAndUpdates.js';
import { LocationShareLinks1791198170977 } from './1791198170977-LocationShareLinks.js';
import { ChatVoiceAndLocation1791198713497 } from './1791198713497-ChatVoiceAndLocation.js';
import { GroupCoverImage1791199500000 } from './1791199500000-GroupCoverImage.js';
import { AvatarAndRoute1791200000000 } from './1791200000000-AvatarAndRoute.js';
import { WaypointTimes1791201000000 } from './1791201000000-WaypointTimes.js';
import { AttendanceAndSavedPlaces1791202000000 } from './1791202000000-AttendanceAndSavedPlaces.js';
import { Notifications1791203000000 } from './1791203000000-Notifications.js';
import { InviteCodes1791204000000 } from './1791204000000-InviteCodes.js';
import { ChatRepliesNotesPlaces1791205000000 } from './1791205000000-ChatRepliesNotesPlaces.js';

/**
 * Every migration, in order. Listed explicitly (not a file glob) so it works the same in
 * dev, tests and the compiled Docker image. Add new migrations at the end.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const migrations: Function[] = [
  Baseline1791187931142,
  TimestampsWithTimeZone1791190000000,
  FeedbackAndUsage1791190100000,
  ExpensePayments1791196010867,
  ActivityProgressAndUpdates1791197583046,
  LocationShareLinks1791198170977,
  ChatVoiceAndLocation1791198713497,
  GroupCoverImage1791199500000,
  AvatarAndRoute1791200000000,
  WaypointTimes1791201000000,
  AttendanceAndSavedPlaces1791202000000,
  Notifications1791203000000,
  InviteCodes1791204000000,
  ChatRepliesNotesPlaces1791205000000,
];
