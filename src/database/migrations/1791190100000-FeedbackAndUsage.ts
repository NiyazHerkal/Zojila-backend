import { MigrationInterface, QueryRunner } from "typeorm";

/** Phase 13 beta: in-app feedback, and daily usage counters for the KPIs (PDF §9). */
export class FeedbackAndUsage1791190100000 implements MigrationInterface {
    name = 'FeedbackAndUsage1791190100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "feedback_category_enum" AS ENUM('BUG', 'IDEA', 'OTHER')`);
        await queryRunner.query(`CREATE TYPE "feedback_platform_enum" AS ENUM('ANDROID', 'IOS', 'WEB')`);
        await queryRunner.query(`CREATE TYPE "feedback_status_enum" AS ENUM('NEW', 'IN_PROGRESS', 'DONE', 'WONT_FIX')`);
        await queryRunner.query(`CREATE TABLE "feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid, "category" "feedback_category_enum" NOT NULL, "message" character varying(4000) NOT NULL, "rating" smallint, "screen" character varying(80), "app_version" character varying(40), "platform" "feedback_platform_enum", "os_version" character varying(40), "device_model" character varying(80), "screenshot_key" character varying, "screenshot_content_type" character varying, "status" "feedback_status_enum" NOT NULL DEFAULT 'NEW', "ops_note" character varying(1000), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8389f9e087a57689cd5be8b2b13" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dc1ce65ab411e5b0067e5a0ecd" ON "feedback"  ("status", "created_at") `);
        await queryRunner.query(`CREATE TABLE "usage_daily" ("id" BIGSERIAL NOT NULL, "day" date NOT NULL, "metric" character varying(40) NOT NULL, "user_id" uuid NOT NULL, "group_id" uuid, "count" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_b0d404396506036eee9af200809" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_usage_daily_no_group" ON "usage_daily"  ("day", "metric", "user_id") WHERE "group_id" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_usage_daily_group" ON "usage_daily"  ("day", "metric", "user_id", "group_id") WHERE "group_id" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "feedback" ADD CONSTRAINT "FK_121c67d42dd543cca0809f59901" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "feedback" ADD CONSTRAINT "FK_d0d2add9920ee7c96d3d62fd2e9" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "usage_daily" ADD CONSTRAINT "FK_203b27e5e3fbbe9bbf427ccea26" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "usage_daily" ADD CONSTRAINT "FK_3b43ccb7b1d9caf19c3912a7ae2" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usage_daily" DROP CONSTRAINT "FK_3b43ccb7b1d9caf19c3912a7ae2"`);
        await queryRunner.query(`ALTER TABLE "usage_daily" DROP CONSTRAINT "FK_203b27e5e3fbbe9bbf427ccea26"`);
        await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "FK_d0d2add9920ee7c96d3d62fd2e9"`);
        await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "FK_121c67d42dd543cca0809f59901"`);
        await queryRunner.query(`DROP INDEX "UQ_usage_daily_group"`);
        await queryRunner.query(`DROP INDEX "UQ_usage_daily_no_group"`);
        await queryRunner.query(`DROP TABLE "usage_daily"`);
        await queryRunner.query(`DROP INDEX "IDX_dc1ce65ab411e5b0067e5a0ecd"`);
        await queryRunner.query(`DROP TABLE "feedback"`);
        await queryRunner.query(`DROP TYPE "feedback_status_enum"`);
        await queryRunner.query(`DROP TYPE "feedback_platform_enum"`);
        await queryRunner.query(`DROP TYPE "feedback_category_enum"`);
    }

}
