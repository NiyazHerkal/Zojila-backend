import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Location history, opt-in per group (2026-10-28): saved trail points, consent records, and the
 * per-membership switch. Drops the unused `location_pings` table (never written, 0 rows) that was
 * kept for this feature; the new table hangs off the membership so leaving deletes the trail.
 */
export class LocationHistory1791206000000 implements MigrationInterface {
    name = 'LocationHistory1791206000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "location_pings"`);
        await queryRunner.query(`CREATE TABLE "location_history" ("id" BIGSERIAL NOT NULL, "group_id" uuid NOT NULL, "user_id" uuid NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "accuracy" real, "heading" real, "speed" real, "recorded_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, CONSTRAINT "PK_969935adbd171d824b649bc03d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_location_history_recorded_at" ON "location_history"  ("recorded_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_location_history_member_time" ON "location_history"  ("group_id", "user_id", "recorded_at") `);
        await queryRunner.query(`CREATE TYPE "public"."location_history_consents_action_enum" AS ENUM('GRANTED', 'WITHDRAWN')`);
        await queryRunner.query(`CREATE TABLE "location_history_consents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid NOT NULL, "action" "public"."location_history_consents_action_enum" NOT NULL, "notice_version" character varying(20), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a2dcad48cf9f230eff6e2e45237" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_location_history_consents_user_group" ON "location_history_consents"  ("user_id", "group_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "group_members" ADD "location_history_enabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "group_members" ADD "location_history_enabled_at" TIMESTAMP(3) WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "location_history" ADD CONSTRAINT "FK_ceab001edc271cc86e167b454ab" FOREIGN KEY ("group_id", "user_id") REFERENCES "group_members"("group_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "location_history_consents" ADD CONSTRAINT "FK_a31e379260f8edace29f2580a6a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "location_history_consents" ADD CONSTRAINT "FK_53832322cb0ce9c0dadada8c296" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "location_history_consents" DROP CONSTRAINT "FK_53832322cb0ce9c0dadada8c296"`);
        await queryRunner.query(`ALTER TABLE "location_history_consents" DROP CONSTRAINT "FK_a31e379260f8edace29f2580a6a"`);
        await queryRunner.query(`ALTER TABLE "location_history" DROP CONSTRAINT "FK_ceab001edc271cc86e167b454ab"`);
        await queryRunner.query(`ALTER TABLE "group_members" DROP COLUMN "location_history_enabled_at"`);
        await queryRunner.query(`ALTER TABLE "group_members" DROP COLUMN "location_history_enabled"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_location_history_consents_user_group"`);
        await queryRunner.query(`DROP TABLE "location_history_consents"`);
        await queryRunner.query(`DROP TYPE "public"."location_history_consents_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_location_history_member_time"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_location_history_recorded_at"`);
        await queryRunner.query(`DROP TABLE "location_history"`);
        await queryRunner.query(`CREATE TABLE "location_pings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b666c5c0408c8bd318811640532" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_218df7781a2c577c0021e39fb9" ON "location_pings"  ("group_id", "recorded_at") `);
        await queryRunner.query(`ALTER TABLE "location_pings" ADD CONSTRAINT "FK_f40ed0b01087933f5481334432a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "location_pings" ADD CONSTRAINT "FK_a56c0d5440d8fffa34abf8abe64" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
