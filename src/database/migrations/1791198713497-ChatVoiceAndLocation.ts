import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Change request v1.0, change 8: chat messages can be TEXT, LOCATION or VOICE. Existing rows are TEXT.
 */
export class ChatVoiceAndLocation1791198713497 implements MigrationInterface {
    name = 'ChatVoiceAndLocation1791198713497'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "messages_kind_enum" AS ENUM('TEXT', 'LOCATION', 'VOICE')`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "kind" "messages_kind_enum" NOT NULL DEFAULT 'TEXT'`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "voice_key" character varying`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "voice_content_type" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "voice_duration_ms" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "voice_duration_ms"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "voice_content_type"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "voice_key"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "kind"`);
        await queryRunner.query(`DROP TYPE "messages_kind_enum"`);
    }

}
