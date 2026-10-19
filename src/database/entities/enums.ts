export enum OtpPurpose {
  SIGNUP_VERIFICATION = 'SIGNUP_VERIFICATION',
  LOGIN = 'LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

export enum GroupRole {
  ADMIN = 'ADMIN',
  VIEWER = 'VIEWER',
}

export enum InviteChannel {
  LINK = 'LINK',
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}

export enum InviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  REVOKED = 'REVOKED',
}

export enum ItineraryStatus {
  DRAFT = 'DRAFT',
  LOCKED = 'LOCKED',
}

export enum WaypointDetailType {
  ACCOMMODATION = 'ACCOMMODATION',
  ACTIVITY = 'ACTIVITY',
  DINING = 'DINING',
  EVENT = 'EVENT',
}

export enum ShareDuration {
  ONE_HOUR = 'ONE_HOUR',
  FOUR_HOURS = 'FOUR_HOURS',
  EIGHT_HOURS = 'EIGHT_HOURS',
  ALWAYS = 'ALWAYS',
}

export enum DevicePlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  WEB = 'WEB',
}

// NORMAL = chat message. The rest are alerts (PDF §2.5): GENERAL (announcement), CRITICAL
// (weather / road closure / safety, needs acknowledging) and SOS (emergency, needs acknowledging).
export enum MessageType {
  NORMAL = 'NORMAL',
  GENERAL = 'GENERAL',
  CRITICAL = 'CRITICAL',
  SOS = 'SOS',
}

// What a CRITICAL alert is about (PDF §2.5: weather / road closures / safety).
export enum AlertCategory {
  WEATHER = 'WEATHER',
  ROAD_CLOSURE = 'ROAD_CLOSURE',
  SAFETY = 'SAFETY',
  OTHER = 'OTHER',
}

export enum TripStatus {
  ARRIVED = 'ARRIVED',
  STOPPED = 'STOPPED',
  NEED_HELP = 'NEED_HELP',
  IN_TRANSIT = 'IN_TRANSIT',
}

// Expense categories (PDF §2.7: accommodation, fuel, food, etc.).
export enum ExpenseCategory {
  ACCOMMODATION = 'ACCOMMODATION',
  FUEL = 'FUEL',
  FOOD = 'FOOD',
  TRANSPORT = 'TRANSPORT',
  ACTIVITIES = 'ACTIVITIES',
  SHOPPING = 'SHOPPING',
  PERMITS_FEES = 'PERMITS_FEES',
  OTHER = 'OTHER',
}

// EQUAL = the amount divided evenly between the chosen members; CUSTOM = an exact amount per member.
export enum SplitType {
  EQUAL = 'EQUAL',
  CUSTOM = 'CUSTOM',
}

// In-app feedback (Phase 13 beta).
export enum FeedbackCategory {
  BUG = 'BUG',
  IDEA = 'IDEA',
  OTHER = 'OTHER',
}

export enum FeedbackStatus {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  WONT_FIX = 'WONT_FIX',
}

// Actions counted in usage_daily for the beta KPIs (PDF §9).
export enum UsageMetric {
  APP_CONNECTED = 'APP_CONNECTED', // socket connected = the app was open (daily active users)
  LOCATION_SHARE_STARTED = 'LOCATION_SHARE_STARTED',
  ITINERARY_PDF_EXPORTED = 'ITINERARY_PDF_EXPORTED',
  EXPENSE_REPORT_EXPORTED = 'EXPENSE_REPORT_EXPORTED',
  OFFLINE_BUNDLE_FETCHED = 'OFFLINE_BUNDLE_FETCHED',
}

// Progress of one itinerary stop ("activity", change request v1.0 change 3). No row = UPCOMING.
export enum ActivityStatus {
  UPCOMING = 'UPCOMING',
  CURRENT = 'CURRENT',
  COMPLETED = 'COMPLETED',
}

// How long a live-location link for someone outside the app lasts (change request v1.0, change 10).
export enum LiveShareDuration {
  FIFTEEN_MINUTES = 'FIFTEEN_MINUTES',
  ONE_HOUR = 'ONE_HOUR',
  EIGHT_HOURS = 'EIGHT_HOURS',
}

export enum LiveShareEndReason {
  STOPPED = 'STOPPED',
  EXPIRED = 'EXPIRED',
}

// What a chat message carries (change request v1.0, change 8). Alerts are TEXT. No images,
// files or video: the CR keeps chat to text, emoji, location and voice.
export enum MessageKind {
  TEXT = 'TEXT',
  LOCATION = 'LOCATION',
  VOICE = 'VOICE',
}
