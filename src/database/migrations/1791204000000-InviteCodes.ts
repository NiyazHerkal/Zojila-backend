import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Short invite codes (2026-10-26): share-link invites also get an 8-character code people can type
 * into the app, since the link domain isn't live. Only its SHA-256 hash is stored, like the token.
 */
export class InviteCodes1791204000000 implements MigrationInterface {
    name = 'InviteCodes1791204000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invites" ADD "code_hash" character varying`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "UQ_invites_code_hash" UNIQUE ("code_hash")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "UQ_invites_code_hash"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP COLUMN "code_hash"`);
    }

}
