import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Frontend requests (2026-10-27): expense notes, the place a stop was picked from (address and
 * provider id), and chat delete / reply / forward.
 */
export class ChatRepliesNotesPlaces1791205000000 implements MigrationInterface {
    name = 'ChatRepliesNotesPlaces1791205000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "waypoints" ADD "address" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "waypoints" ADD "provider_place_id" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "reply_to_id" uuid`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "forwarded" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "deleted_at" TIMESTAMP(3) WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "expenses" ADD "notes" text`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_54e66104dd534ed1c191e44096f" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_54e66104dd534ed1c191e44096f"`);
        await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "notes"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "forwarded"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "reply_to_id"`);
        await queryRunner.query(`ALTER TABLE "waypoints" DROP COLUMN "provider_place_id"`);
        await queryRunner.query(`ALTER TABLE "waypoints" DROP COLUMN "address"`);
    }

}
