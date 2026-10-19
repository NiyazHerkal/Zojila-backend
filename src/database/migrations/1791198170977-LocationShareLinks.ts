import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Change request v1.0, change 10: live location shared with people outside the app via a link.
 */
export class LocationShareLinks1791198170977 implements MigrationInterface {
    name = 'LocationShareLinks1791198170977'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "location_share_links_duration_enum" AS ENUM('FIFTEEN_MINUTES', 'ONE_HOUR', 'EIGHT_HOURS')`);
        await queryRunner.query(`CREATE TYPE "location_share_links_end_reason_enum" AS ENUM('STOPPED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "location_share_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "recipient_label" character varying(60), "token_hash" character varying(64) NOT NULL, "duration" "location_share_links_duration_enum" NOT NULL, "started_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "ended_at" TIMESTAMP(3) WITH TIME ZONE, "end_reason" "location_share_links_end_reason_enum", "first_viewed_at" TIMESTAMP(3) WITH TIME ZONE, "last_viewed_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "UQ_454f7039610099051bb601a90b3" UNIQUE ("token_hash"), CONSTRAINT "PK_2ecbdd8e3f40971fb5f298220d7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_aa0dc09ff76f5008a1b691f4e9" ON "location_share_links"  ("user_id", "expires_at") `);
        await queryRunner.query(`ALTER TABLE "location_share_links" ADD CONSTRAINT "FK_99ea3abd4371c58d4132f064503" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "location_share_links" DROP CONSTRAINT "FK_99ea3abd4371c58d4132f064503"`);
        await queryRunner.query(`DROP INDEX "IDX_aa0dc09ff76f5008a1b691f4e9"`);
        await queryRunner.query(`DROP TABLE "location_share_links"`);
        await queryRunner.query(`DROP TYPE "location_share_links_end_reason_enum"`);
        await queryRunner.query(`DROP TYPE "location_share_links_duration_enum"`);
    }

}
