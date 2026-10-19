import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ExpenseCategory, SplitType } from '../../database/entities/index.js';

const MAX_AMOUNT = 10_000_000;
const MAX_SPLIT_MEMBERS = 200;

/** Money: a positive number with at most 2 decimals, in the group's currency. */
function IsAmount(): PropertyDecorator {
  return (target, key) => {
    IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })(target, key);
    Min(0.01)(target, key);
    Max(MAX_AMOUNT)(target, key);
  };
}

function IsDay(): PropertyDecorator {
  return (target, key) => {
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: `${String(key)} must be YYYY-MM-DD` })(target, key);
    IsDateString({ strict: true })(target, key);
  };
}

export class ShareDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 450.5 })
  @IsAmount()
  amount!: number;
}

export class PaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 600 })
  @IsAmount()
  amount!: number;
}

export class CreateExpenseDto {
  @ApiProperty({ example: 1200, description: 'Up to 2 decimals, in the group currency' })
  @IsAmount()
  amount!: number;

  @ApiProperty({ enum: ExpenseCategory, example: ExpenseCategory.FUEL })
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @ApiProperty({ example: '2026-10-11', description: 'The day it was spent (YYYY-MM-DD)' })
  @IsDay()
  date!: string;

  @ApiPropertyOptional({ example: 'Diesel at Tandi pump', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Who paid the whole amount (a member). Defaults to you. Use `payments` instead when several people paid.',
  })
  @IsOptional()
  @IsUUID()
  paidBy?: string;

  @ApiPropertyOptional({
    type: [PaymentDto],
    description: 'When several people paid: how much each paid, adding up to `amount`. Not together with `paidBy`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SPLIT_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments?: PaymentDto[];

  @ApiPropertyOptional({
    example: '06b1e0c2-4d55-4c6e-9a51-6c1f0d8f9b20',
    maxLength: 64,
    description: 'Your own id for this expense (e.g. a UUID). Re-sending it returns the original instead of a duplicate.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId?: string;

  @ApiProperty({ enum: SplitType, example: SplitType.EQUAL })
  @IsEnum(SplitType)
  splitType!: SplitType;

  @ApiPropertyOptional({
    type: [String],
    description: 'EQUAL only: the members sharing it. Defaults to every current member.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SPLIT_MEMBERS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  splitBetween?: string[];

  @ApiPropertyOptional({ type: [ShareDto], description: 'CUSTOM only: exact amount per member, adding up to `amount`.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SPLIT_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares?: ShareDto[];
}

/**
 * Send only what changes. `description: null` clears it. Changing the amount of an EQUAL
 * expense re-splits it between the same members; a CUSTOM one needs new `shares` too, and one
 * that several people paid needs new `payments`.
 */
export class UpdateExpenseDto extends PartialType(OmitType(CreateExpenseDto, ['clientId'] as const)) {}

export class ListExpensesQueryDto {
  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only expenses this member paid (all or part of)' })
  @IsOptional()
  @IsUUID()
  paidBy?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only expenses this member paid or shares in' })
  @IsOptional()
  @IsUUID()
  involving?: string;

  @ApiPropertyOptional({ example: '2026-10-10', description: 'From this day (inclusive)' })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-19', description: 'Up to this day (inclusive)' })
  @IsOptional()
  @IsDay()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Paging cursor: the previous page’s `nextBefore`' })
  @IsOptional()
  @IsUUID()
  before?: string;
}

export class CreateSettlementDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Who paid the money back. Defaults to you.' })
  @IsOptional()
  @IsUUID()
  fromUserId?: string;

  @ApiProperty({ format: 'uuid', description: 'Who received it' })
  @IsUUID()
  toUserId!: string;

  @ApiProperty({ example: 450 })
  @IsAmount()
  amount!: number;

  @ApiPropertyOptional({ example: '2026-10-20', description: 'Defaults to today' })
  @IsOptional()
  @IsDay()
  date?: string;

  @ApiPropertyOptional({ example: 'UPI', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

export class ReportQueryDto {
  @ApiPropertyOptional({ enum: ['pdf', 'csv'], default: 'pdf' })
  @IsOptional()
  @IsIn(['pdf', 'csv'])
  format?: 'pdf' | 'csv';
}
