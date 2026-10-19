/**
 * Money maths for expenses. Everything is done in integer minor units (paise/cents), so totals
 * never drift the way floating-point sums do. The API takes and returns plain numbers with up
 * to 2 decimals.
 */

/** 1234.5 → 123450. The DTOs already reject more than 2 decimals. */
export function toMinor(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

/** 123450 → 1234.5 (a JSON number). */
export function fromMinor(minor: number): number {
  return minor / 100;
}

/** 123450 → "1234.50" (for the DB decimal column and reports). */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Splits `totalMinor` evenly between `userIds` (in the given order). Leftover paise go one
 * each to the first members, e.g. 100.00 between 3 → 33.34, 33.33, 33.33.
 */
export function splitEqually(totalMinor: number, userIds: string[]): Map<string, number> {
  const base = Math.floor(totalMinor / userIds.length);
  const remainder = totalMinor - base * userIds.length;
  return new Map(userIds.map((id, i) => [id, base + (i < remainder ? 1 : 0)]));
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

/**
 * "Who owes whom": turns balances (positive = is owed money, negative = owes money; they sum
 * to 0) into a short list of payments. Greedy: the biggest debtor pays the biggest creditor,
 * repeatedly. That gives at most (people with a balance − 1) payments. Ties are broken by user
 * id so the result is stable between calls.
 */
export function settleUp(balances: Map<string, number>): Transfer[] {
  const byAmount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
  const creditors = [...balances].filter(([, v]) => v > 0).sort(byAmount);
  const debtors = [...balances]
    .filter(([, v]) => v < 0)
    .map(([id, v]): [string, number] => [id, -v])
    .sort(byAmount);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const amount = Math.min(creditors[c][1], debtors[d][1]);
    transfers.push({ fromUserId: debtors[d][0], toUserId: creditors[c][0], amountMinor: amount });
    creditors[c][1] -= amount;
    debtors[d][1] -= amount;
    if (creditors[c][1] === 0) c++;
    if (debtors[d][1] === 0) d++;
  }
  return transfers;
}
