import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Per-member arrival at itinerary stops (activity_attendance) and server-side saved places
 * (saved_places). Backend handover of 2026-10-22 (P-03, P-07).
 */
export class AttendanceAndSavedPlaces1791202000000 implements MigrationInterface {
    name = 'AttendanceAndSavedPlaces1791202000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "activity_attendance" ("group_id" uuid NOT NULL, "stop_key" uuid NOT NULL, "user_id" uuid NOT NULL, "arrived_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_38f58b13c875f0d86db95219574" PRIMARY KEY ("group_id", "stop_key", "user_id"))`);
        await queryRunner.query(`CREATE TYPE "public"."saved_places_source_enum" AS ENUM('PROVIDER', 'PIN')`);
        await queryRunner.query(`CREATE TABLE "saved_places" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "place_key" character varying(200) NOT NULL, "source" "public"."saved_places_source_enum" NOT NULL, "provider_place_id" character varying(200), "name" character varying(200) NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "address" character varying(500), "category" character varying(60), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2fe824e346daa89e58c9b09b0a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_saved_places_user_place_key" ON "saved_places"  ("user_id", "place_key") `);
        await queryRunner.query(`ALTER TABLE "activity_attendance" ADD CONSTRAINT "FK_4c2d3693af221b53ecf5abf7d6c" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activity_attendance" ADD CONSTRAINT "FK_56bda3e4efc10c981f96dc7518f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "saved_places" ADD CONSTRAINT "FK_5bb29ee5138abb8b91fcd264844" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "saved_places" DROP CONSTRAINT "FK_5bb29ee5138abb8b91fcd264844"`);
        await queryRunner.query(`ALTER TABLE "activity_attendance" DROP CONSTRAINT "FK_56bda3e4efc10c981f96dc7518f"`);
        await queryRunner.query(`ALTER TABLE "activity_attendance" DROP CONSTRAINT "FK_4c2d3693af221b53ecf5abf7d6c"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_saved_places_user_place_key"`);
        await queryRunner.query(`DROP TABLE "saved_places"`);
        await queryRunner.query(`DROP TYPE "public"."saved_places_source_enum"`);
        await queryRunner.query(`DROP TABLE "activity_attendance"`);
    }

}
