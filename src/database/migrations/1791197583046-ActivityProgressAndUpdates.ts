import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Change request v1.0, changes 3 and 4: activity (= itinerary stop) status and text updates.
 * Waypoints get a stop_key that new versions copy; existing rows each get a fresh one.
 */
export class ActivityProgressAndUpdates1791197583046 implements MigrationInterface {
    name = 'ActivityProgressAndUpdates1791197583046'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "activity_progress_status_enum" AS ENUM('UPCOMING', 'CURRENT', 'COMPLETED')`);
        await queryRunner.query(`CREATE TABLE "activity_progress" ("group_id" uuid NOT NULL, "stop_key" uuid NOT NULL, "status" "activity_progress_status_enum" NOT NULL, "updated_by" uuid NOT NULL, "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f988655b49238e85b61bea3c0f5" PRIMARY KEY ("group_id", "stop_key"))`);
        await queryRunner.query(`CREATE TABLE "activity_updates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "group_id" uuid NOT NULL, "stop_key" uuid NOT NULL, "user_id" uuid NOT NULL, "text" character varying(1000) NOT NULL, "client_id" character varying(64), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "edited_at" TIMESTAMP(3) WITH TIME ZONE, "deleted_at" TIMESTAMP(3) WITH TIME ZONE, "deleted_by" uuid, CONSTRAINT "PK_f5ee4b09c5358171006fc764fdd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_activity_updates_user_client_id" ON "activity_updates"  ("user_id", "client_id") WHERE "client_id" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_9cde2c15fc3e6c3c33b9655ac7" ON "activity_updates"  ("group_id", "stop_key", "created_at") `);
        await queryRunner.query(`ALTER TABLE "waypoints" ADD "stop_key" uuid NOT NULL DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_waypoints_itinerary_stop_key" ON "waypoints"  ("itinerary_id", "stop_key") `);
        await queryRunner.query(`ALTER TABLE "activity_progress" ADD CONSTRAINT "FK_e8065efbd2179ed00089f6ddcf4" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activity_progress" ADD CONSTRAINT "FK_71b1ad4cb2f505c9448f297a676" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activity_updates" ADD CONSTRAINT "FK_f400b07c53ef898cf6a802077ea" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activity_updates" ADD CONSTRAINT "FK_342f9de430dddd5f42bf8f7e1bb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "activity_updates" DROP CONSTRAINT "FK_342f9de430dddd5f42bf8f7e1bb"`);
        await queryRunner.query(`ALTER TABLE "activity_updates" DROP CONSTRAINT "FK_f400b07c53ef898cf6a802077ea"`);
        await queryRunner.query(`ALTER TABLE "activity_progress" DROP CONSTRAINT "FK_71b1ad4cb2f505c9448f297a676"`);
        await queryRunner.query(`ALTER TABLE "activity_progress" DROP CONSTRAINT "FK_e8065efbd2179ed00089f6ddcf4"`);
        await queryRunner.query(`DROP INDEX "UQ_waypoints_itinerary_stop_key"`);
        await queryRunner.query(`ALTER TABLE "waypoints" DROP COLUMN "stop_key"`);
        await queryRunner.query(`DROP INDEX "IDX_9cde2c15fc3e6c3c33b9655ac7"`);
        await queryRunner.query(`DROP INDEX "UQ_activity_updates_user_client_id"`);
        await queryRunner.query(`DROP TABLE "activity_updates"`);
        await queryRunner.query(`DROP TABLE "activity_progress"`);
        await queryRunner.query(`DROP TYPE "activity_progress_status_enum"`);
    }

}
