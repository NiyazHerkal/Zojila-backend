import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Optional start/end time of an itinerary stop (waypoints.start_time / end_time), wall-clock
 * time at the stop. Backend handover of 2026-10-22 (P-01).
 */
export class WaypointTimes1791201000000 implements MigrationInterface {
    name = 'WaypointTimes1791201000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "waypoints" ADD "start_time" TIME`);
        await queryRunner.query(`ALTER TABLE "waypoints" ADD "end_time" TIME`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "waypoints" DROP COLUMN "end_time"`);
        await queryRunner.query(`ALTER TABLE "waypoints" DROP COLUMN "start_time"`);
    }

}
