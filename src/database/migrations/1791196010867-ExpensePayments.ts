import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Change request v1.0, change 6: several people can pay one expense. Existing expenses get one
 * payment row: the payer, for the full amount.
 */
export class ExpensePayments1791196010867 implements MigrationInterface {
    name = 'ExpensePayments1791196010867'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "expense_payments" ("expense_id" uuid NOT NULL, "user_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, CONSTRAINT "PK_3866ef45a63e7793ca044c5d9e6" PRIMARY KEY ("expense_id", "user_id"))`);
        await queryRunner.query(`ALTER TABLE "expense_payments" ADD CONSTRAINT "FK_57d4005460118d332e1a0d38be9" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_payments" ADD CONSTRAINT "FK_ef2045bad262bb65206893ad22e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`INSERT INTO "expense_payments" ("expense_id", "user_id", "amount") SELECT "id", "payer_id", "amount" FROM "expenses"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "expense_payments" DROP CONSTRAINT "FK_ef2045bad262bb65206893ad22e"`);
        await queryRunner.query(`ALTER TABLE "expense_payments" DROP CONSTRAINT "FK_57d4005460118d332e1a0d38be9"`);
        await queryRunner.query(`DROP TABLE "expense_payments"`);
    }

}
