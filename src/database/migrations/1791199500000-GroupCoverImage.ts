import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Optional trip cover image (frontend request 2026-10-08). Existing groups have none.
 */
export class GroupCoverImage1791199500000 implements MigrationInterface {
    name = 'GroupCoverImage1791199500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "groups" ADD "cover_image_key" character varying`);
        await queryRunner.query(`ALTER TABLE "groups" ADD "cover_image_content_type" character varying(40)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "cover_image_content_type"`);
        await queryRunner.query(`ALTER TABLE "groups" DROP COLUMN "cover_image_key"`);
    }

}
