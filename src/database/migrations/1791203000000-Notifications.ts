import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Notifications feed (backend handover of 2026-10-22, Q2): one row per notification per user.
 */
export class Notifications1791203000000 implements MigrationInterface {
    name = 'Notifications1791203000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "group_id" uuid, "type" character varying(40) NOT NULL, "title" character varying(200) NOT NULL, "body" character varying(1000) NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "read_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_310667f935698fcd8cb319113a" ON "notifications"  ("user_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_eaba0138c54227e2eafd7288122" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_eaba0138c54227e2eafd7288122"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_310667f935698fcd8cb319113a"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
    }

}
