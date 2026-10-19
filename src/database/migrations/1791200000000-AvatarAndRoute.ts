import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Uploaded profile pictures (users.avatar_key / avatar_content_type) and the cached road route
 * of each itinerary version (itineraries.route_json). Change requests of 2026-10-14.
 */
export class AvatarAndRoute1791200000000 implements MigrationInterface {
    name = 'AvatarAndRoute1791200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "avatar_key" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD "avatar_content_type" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "itineraries" ADD "route_json" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "itineraries" DROP COLUMN "route_json"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_content_type"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_key"`);
    }

}
