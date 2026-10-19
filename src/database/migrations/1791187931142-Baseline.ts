import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The schema as it was when migrations replaced `synchronize` (2026-10-05), generated from the
 * entities. Databases created before then by `synchronize` already have it, so this does
 * nothing there (it only checks for the users table) and just gets recorded as applied.
 */
export class Baseline1791187931142 implements MigrationInterface {
    name = 'Baseline1791187931142'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('users')) return; // created earlier by synchronize
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "group_members_role_enum" AS ENUM('ADMIN', 'VIEWER')`);
        await queryRunner.query(`CREATE TABLE "group_members" ("group_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "group_members_role_enum" NOT NULL DEFAULT 'VIEWER', "joined_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f5939ee0ad233ad35e03f5c65c1" PRIMARY KEY ("group_id", "user_id"))`);
        await queryRunner.query(`CREATE TYPE "invites_channel_enum" AS ENUM('LINK', 'SMS', 'EMAIL')`);
        await queryRunner.query(`CREATE TYPE "invites_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED')`);
        await queryRunner.query(`CREATE TABLE "invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "token_hash" character varying, "channel" "invites_channel_enum" NOT NULL, "status" "invites_status_enum" NOT NULL DEFAULT 'PENDING', "invitee_email" character varying, "invitee_phone" character varying, "invitee_user_id" uuid, "invited_by" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "responded_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_0843131f4ae91435709527a4f18" UNIQUE ("token_hash"), CONSTRAINT "PK_aa52e96b44a714372f4dd31a0af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "waypoint_details_type_enum" AS ENUM('ACCOMMODATION', 'ACTIVITY', 'DINING', 'EVENT')`);
        await queryRunner.query(`CREATE TABLE "waypoint_details" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "waypoint_id" uuid NOT NULL, "type" "waypoint_details_type_enum" NOT NULL, "payload" jsonb NOT NULL, CONSTRAINT "PK_1eda35b1bc713077ef3af5be56a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "waypoints" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "itinerary_id" uuid NOT NULL, "order" integer NOT NULL, "name" character varying NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "date" date, "notes" character varying, "elevation" double precision, "weather_json" jsonb, "reviews_json" jsonb, CONSTRAINT "PK_767da123db02490889bd6eaab4e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6f42be22e9ac58601792d4be59" ON "waypoints"  ("itinerary_id", "order") `);
        await queryRunner.query(`CREATE TYPE "itineraries_status_enum" AS ENUM('DRAFT', 'LOCKED')`);
        await queryRunner.query(`CREATE TABLE "itineraries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "status" "itineraries_status_enum" NOT NULL DEFAULT 'DRAFT', "created_by" uuid NOT NULL, "version" integer, "based_on_version" integer, "revision" integer NOT NULL DEFAULT '0', "locked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9c5db87d0f85f56e4466ae09a38" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_itineraries_group_version" ON "itineraries"  ("group_id", "version") WHERE "version" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_itineraries_one_draft_per_group" ON "itineraries"  ("group_id") WHERE "status" = 'DRAFT'`);
        await queryRunner.query(`CREATE TABLE "location_pings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "recorded_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b666c5c0408c8bd318811640532" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_218df7781a2c577c0021e39fb9" ON "location_pings"  ("group_id", "recorded_at") `);
        await queryRunner.query(`CREATE TABLE "message_acks" ("message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "acked_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e616e7ab882b13da1c8dfd082c0" PRIMARY KEY ("message_id", "user_id"))`);
        await queryRunner.query(`CREATE TYPE "messages_type_enum" AS ENUM('NORMAL', 'GENERAL', 'CRITICAL', 'SOS')`);
        await queryRunner.query(`CREATE TYPE "messages_category_enum" AS ENUM('WEATHER', 'ROAD_CLOSURE', 'SAFETY', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "sender_id" uuid NOT NULL, "body" text NOT NULL, "type" "messages_type_enum" NOT NULL DEFAULT 'NORMAL', "category" "messages_category_enum", "client_msg_id" character varying(64), "location" jsonb, "resolved_at" TIMESTAMP(3) WITH TIME ZONE, "resolved_by" uuid, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_messages_sender_client_msg" ON "messages"  ("sender_id", "client_msg_id") WHERE "client_msg_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_d3f456648f7ce49412a45bcab5" ON "messages"  ("group_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "status_updates_status_enum" AS ENUM('ARRIVED', 'STOPPED', 'NEED_HELP', 'IN_TRANSIT')`);
        await queryRunner.query(`CREATE TABLE "status_updates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid NOT NULL, "status" "status_updates_status_enum" NOT NULL, "note" character varying(280), "client_id" character varying(64), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a4dc636b9a35229ec5cee2b1dfb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_status_updates_user_client_id" ON "status_updates"  ("user_id", "client_id") WHERE "client_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_60afb7a948a7980d61768494dc" ON "status_updates"  ("group_id", "user_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "expense_splits" ("expense_id" uuid NOT NULL, "user_id" uuid NOT NULL, "share_amount" numeric(10,2) NOT NULL, CONSTRAINT "PK_73d8301cb7af4be427711bebf1c" PRIMARY KEY ("expense_id", "user_id"))`);
        await queryRunner.query(`CREATE TYPE "expenses_category_enum" AS ENUM('ACCOMMODATION', 'FUEL', 'FOOD', 'TRANSPORT', 'ACTIVITIES', 'SHOPPING', 'PERMITS_FEES', 'OTHER')`);
        await queryRunner.query(`CREATE TYPE "expenses_split_type_enum" AS ENUM('EQUAL', 'CUSTOM')`);
        await queryRunner.query(`CREATE TABLE "expenses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "payer_id" uuid NOT NULL, "created_by" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "category" "expenses_category_enum" NOT NULL, "spent_on" date NOT NULL, "description" character varying(500), "split_type" "expenses_split_type_enum" NOT NULL, "client_id" character varying(64), "receipt_key" character varying, "receipt_content_type" character varying, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_94c3ceb17e3140abc9282c20610" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_expenses_creator_client_id" ON "expenses"  ("created_by", "client_id") WHERE "client_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_a95f89421e873f685e65f7a62d" ON "expenses"  ("group_id", "spent_on") `);
        await queryRunner.query(`CREATE TABLE "groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" character varying NOT NULL, "trip_start" TIMESTAMP WITH TIME ZONE NOT NULL, "trip_end" TIMESTAMP WITH TIME ZONE NOT NULL, "currency" character(3) NOT NULL DEFAULT 'INR', "closed_at" TIMESTAMP WITH TIME ZONE, "delete_after" TIMESTAMP WITH TIME ZONE, "created_by" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_659d1483316afb28afd3a90646e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "users_otp_purpose_enum" AS ENUM('SIGNUP_VERIFICATION', 'LOGIN', 'PASSWORD_RESET')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying, "phone" character varying, "username" character varying NOT NULL, "password_hash" character varying NOT NULL, "name" character varying NOT NULL, "avatar_url" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP(3) WITH TIME ZONE, "email_verified" boolean NOT NULL DEFAULT false, "phone_verified" boolean NOT NULL DEFAULT false, "otp_code_hash" character varying, "otp_expires_at" TIMESTAMP WITH TIME ZONE, "otp_purpose" "users_otp_purpose_enum", "otp_attempts" integer NOT NULL DEFAULT '0', "password_reset_token_hash" character varying, "password_reset_expires_at" TIMESTAMP WITH TIME ZONE, "password_reset_attempts" integer NOT NULL DEFAULT '0', "refresh_token_hash" character varying, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone"), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "location_shares_duration_enum" AS ENUM('ONE_HOUR', 'FOUR_HOURS', 'EIGHT_HOURS', 'ALWAYS')`);
        await queryRunner.query(`CREATE TABLE "location_shares" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid NOT NULL, "duration" "location_shares_duration_enum" NOT NULL, "started_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "UQ_location_shares_group_user" UNIQUE ("group_id", "user_id"), CONSTRAINT "PK_3d5f46a72c6856676d05f0b66e2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "message_reads" ("group_id" uuid NOT NULL, "user_id" uuid NOT NULL, "last_read_message_id" uuid NOT NULL, "last_read_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, CONSTRAINT "PK_d0b2b54b7245afe65eeef5b9844" PRIMARY KEY ("group_id", "user_id"))`);
        await queryRunner.query(`CREATE TABLE "expense_settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "from_user_id" uuid NOT NULL, "to_user_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "paid_on" date NOT NULL, "note" character varying(280), "created_by" uuid NOT NULL, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8916d69dd79b4dc0c9faa8425d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5cec6b64c0bfa7d8822e227351" ON "expense_settlements"  ("group_id", "paid_on") `);
        await queryRunner.query(`CREATE TYPE "device_tokens_platform_enum" AS ENUM('ANDROID', 'IOS', 'WEB')`);
        await queryRunner.query(`CREATE TABLE "device_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token" character varying(4096) NOT NULL, "platform" "device_tokens_platform_enum" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_977e24c520c49436d08e5eeea8a" UNIQUE ("token"), CONSTRAINT "PK_84700be257607cfb1f9dc2e52c3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "group_members" ADD CONSTRAINT "FK_2c840df5db52dc6b4a1b0b69c6e" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "group_members" ADD CONSTRAINT "FK_20a555b299f75843aa53ff8b0ee" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_33dcb9a9ea41dfa512fac08c368" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_41d9a45258bf826d778cb6845e8" FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_6e727f063d839c0090364ea95f3" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "waypoint_details" ADD CONSTRAINT "FK_6438ea6529b69bc509ab156b4d2" FOREIGN KEY ("waypoint_id") REFERENCES "waypoints"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "waypoints" ADD CONSTRAINT "FK_b7d06560ba05be45264c4ee5182" FOREIGN KEY ("itinerary_id") REFERENCES "itineraries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "itineraries" ADD CONSTRAINT "FK_e2e824d7482f3e865a2c2556093" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "itineraries" ADD CONSTRAINT "FK_4e7416dc6959241ece8696ab356" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "location_pings" ADD CONSTRAINT "FK_f40ed0b01087933f5481334432a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "location_pings" ADD CONSTRAINT "FK_a56c0d5440d8fffa34abf8abe64" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_acks" ADD CONSTRAINT "FK_2b2d5b71176740f5f400b07df6a" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_acks" ADD CONSTRAINT "FK_890baaa61d319d5c770b439d143" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_d3607f0e3fc4217505168fc3932" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_22133395bd13b970ccd0c34ab22" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_f912aadc922b7220db2bf0c0098" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "status_updates" ADD CONSTRAINT "FK_e54cc71c1fbd342a50d948aa963" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "status_updates" ADD CONSTRAINT "FK_9d03b516090a79a34b9c630067f" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_splits" ADD CONSTRAINT "FK_a4c2e32db9bc4200aad335b93e5" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_splits" ADD CONSTRAINT "FK_008dfb10e46b8d53061b0b6ac26" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_d4e9271763ee685f5d746a4e550" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_846b0e68882344c4de16ebc80ba" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_7c0c012c2f8e6578277c239ee61" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "groups" ADD CONSTRAINT "FK_a2fa29bfd5351b5b7ccacbc9f7c" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "location_shares" ADD CONSTRAINT "FK_aa83bf85c5b44460f833156fd0b" FOREIGN KEY ("group_id", "user_id") REFERENCES "group_members"("group_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "message_reads" ADD CONSTRAINT "FK_d0b2b54b7245afe65eeef5b9844" FOREIGN KEY ("group_id", "user_id") REFERENCES "group_members"("group_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" ADD CONSTRAINT "FK_9652c277f11239c34f16984cf4c" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" ADD CONSTRAINT "FK_41e593cb708f4b17a35931b6de9" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" ADD CONSTRAINT "FK_b1f2ffb2f4238e013b033b20a3c" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" ADD CONSTRAINT "FK_62470bffacd94e53e8ebf1c6186" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "device_tokens" ADD CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "device_tokens" DROP CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea"`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" DROP CONSTRAINT "FK_62470bffacd94e53e8ebf1c6186"`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" DROP CONSTRAINT "FK_b1f2ffb2f4238e013b033b20a3c"`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" DROP CONSTRAINT "FK_41e593cb708f4b17a35931b6de9"`);
        await queryRunner.query(`ALTER TABLE "expense_settlements" DROP CONSTRAINT "FK_9652c277f11239c34f16984cf4c"`);
        await queryRunner.query(`ALTER TABLE "message_reads" DROP CONSTRAINT "FK_d0b2b54b7245afe65eeef5b9844"`);
        await queryRunner.query(`ALTER TABLE "location_shares" DROP CONSTRAINT "FK_aa83bf85c5b44460f833156fd0b"`);
        await queryRunner.query(`ALTER TABLE "groups" DROP CONSTRAINT "FK_a2fa29bfd5351b5b7ccacbc9f7c"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_7c0c012c2f8e6578277c239ee61"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_846b0e68882344c4de16ebc80ba"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_d4e9271763ee685f5d746a4e550"`);
        await queryRunner.query(`ALTER TABLE "expense_splits" DROP CONSTRAINT "FK_008dfb10e46b8d53061b0b6ac26"`);
        await queryRunner.query(`ALTER TABLE "expense_splits" DROP CONSTRAINT "FK_a4c2e32db9bc4200aad335b93e5"`);
        await queryRunner.query(`ALTER TABLE "status_updates" DROP CONSTRAINT "FK_9d03b516090a79a34b9c630067f"`);
        await queryRunner.query(`ALTER TABLE "status_updates" DROP CONSTRAINT "FK_e54cc71c1fbd342a50d948aa963"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_f912aadc922b7220db2bf0c0098"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_22133395bd13b970ccd0c34ab22"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_d3607f0e3fc4217505168fc3932"`);
        await queryRunner.query(`ALTER TABLE "message_acks" DROP CONSTRAINT "FK_890baaa61d319d5c770b439d143"`);
        await queryRunner.query(`ALTER TABLE "message_acks" DROP CONSTRAINT "FK_2b2d5b71176740f5f400b07df6a"`);
        await queryRunner.query(`ALTER TABLE "location_pings" DROP CONSTRAINT "FK_a56c0d5440d8fffa34abf8abe64"`);
        await queryRunner.query(`ALTER TABLE "location_pings" DROP CONSTRAINT "FK_f40ed0b01087933f5481334432a"`);
        await queryRunner.query(`ALTER TABLE "itineraries" DROP CONSTRAINT "FK_4e7416dc6959241ece8696ab356"`);
        await queryRunner.query(`ALTER TABLE "itineraries" DROP CONSTRAINT "FK_e2e824d7482f3e865a2c2556093"`);
        await queryRunner.query(`ALTER TABLE "waypoints" DROP CONSTRAINT "FK_b7d06560ba05be45264c4ee5182"`);
        await queryRunner.query(`ALTER TABLE "waypoint_details" DROP CONSTRAINT "FK_6438ea6529b69bc509ab156b4d2"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "FK_6e727f063d839c0090364ea95f3"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "FK_41d9a45258bf826d778cb6845e8"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "FK_33dcb9a9ea41dfa512fac08c368"`);
        await queryRunner.query(`ALTER TABLE "group_members" DROP CONSTRAINT "FK_20a555b299f75843aa53ff8b0ee"`);
        await queryRunner.query(`ALTER TABLE "group_members" DROP CONSTRAINT "FK_2c840df5db52dc6b4a1b0b69c6e"`);
        await queryRunner.query(`DROP TABLE "device_tokens"`);
        await queryRunner.query(`DROP TYPE "device_tokens_platform_enum"`);
        await queryRunner.query(`DROP INDEX "IDX_5cec6b64c0bfa7d8822e227351"`);
        await queryRunner.query(`DROP TABLE "expense_settlements"`);
        await queryRunner.query(`DROP TABLE "message_reads"`);
        await queryRunner.query(`DROP TABLE "location_shares"`);
        await queryRunner.query(`DROP TYPE "location_shares_duration_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "users_otp_purpose_enum"`);
        await queryRunner.query(`DROP TABLE "groups"`);
        await queryRunner.query(`DROP INDEX "IDX_a95f89421e873f685e65f7a62d"`);
        await queryRunner.query(`DROP INDEX "UQ_expenses_creator_client_id"`);
        await queryRunner.query(`DROP TABLE "expenses"`);
        await queryRunner.query(`DROP TYPE "expenses_split_type_enum"`);
        await queryRunner.query(`DROP TYPE "expenses_category_enum"`);
        await queryRunner.query(`DROP TABLE "expense_splits"`);
        await queryRunner.query(`DROP INDEX "IDX_60afb7a948a7980d61768494dc"`);
        await queryRunner.query(`DROP INDEX "UQ_status_updates_user_client_id"`);
        await queryRunner.query(`DROP TABLE "status_updates"`);
        await queryRunner.query(`DROP TYPE "status_updates_status_enum"`);
        await queryRunner.query(`DROP INDEX "IDX_d3f456648f7ce49412a45bcab5"`);
        await queryRunner.query(`DROP INDEX "UQ_messages_sender_client_msg"`);
        await queryRunner.query(`DROP TABLE "messages"`);
        await queryRunner.query(`DROP TYPE "messages_category_enum"`);
        await queryRunner.query(`DROP TYPE "messages_type_enum"`);
        await queryRunner.query(`DROP TABLE "message_acks"`);
        await queryRunner.query(`DROP INDEX "IDX_218df7781a2c577c0021e39fb9"`);
        await queryRunner.query(`DROP TABLE "location_pings"`);
        await queryRunner.query(`DROP INDEX "UQ_itineraries_one_draft_per_group"`);
        await queryRunner.query(`DROP INDEX "UQ_itineraries_group_version"`);
        await queryRunner.query(`DROP TABLE "itineraries"`);
        await queryRunner.query(`DROP TYPE "itineraries_status_enum"`);
        await queryRunner.query(`DROP INDEX "IDX_6f42be22e9ac58601792d4be59"`);
        await queryRunner.query(`DROP TABLE "waypoints"`);
        await queryRunner.query(`DROP TABLE "waypoint_details"`);
        await queryRunner.query(`DROP TYPE "waypoint_details_type_enum"`);
        await queryRunner.query(`DROP TABLE "invites"`);
        await queryRunner.query(`DROP TYPE "invites_status_enum"`);
        await queryRunner.query(`DROP TYPE "invites_channel_enum"`);
        await queryRunner.query(`DROP TABLE "group_members"`);
        await queryRunner.query(`DROP TYPE "group_members_role_enum"`);
    }

}
