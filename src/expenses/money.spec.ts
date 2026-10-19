import { fromMinor, minorToDecimal, settleUp, splitEqually, toMinor } from './money.js';

describe('expense money maths', () => {
  it('converts to and from paise without float drift', () => {
    expect(toMinor(0.1)).toBe(10);
    expect(toMinor(1234.56)).toBe(123456);
    expect(toMinor('1234.50')).toBe(123450);
    expect(fromMinor(10) + fromMinor(20)).toBeCloseTo(0.3);
    expect(minorToDecimal(123450)).toBe('1234.50');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(-150)).toBe('-1.50');
  });

  it('splits equally and gives leftover paise to the first members', () => {
    const shares = splitEqually(10000, ['a', 'b', 'c']);
    expect([...shares.values()]).toEqual([3334, 3333, 3333]);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(10000);
    expect([...splitEqually(1, ['a', 'b']).values()]).toEqual([1, 0]);
  });

  it('settles balances with the fewest greedy payments, and they clear every balance', () => {
    // Alice paid 900 for 3 (each owes 300); Bob paid 300 for Bob + Carol (150 each).
    const balances = new Map([
      ['alice', 90000 - 30000],
      ['bob', 30000 - 30000 - 15000],
      ['carol', -30000 - 15000],
    ]);
    const transfers = settleUp(balances);
    expect(transfers).toEqual([
      { fromUserId: 'carol', toUserId: 'alice', amountMinor: 45000 },
      { fromUserId: 'bob', toUserId: 'alice', amountMinor: 15000 },
    ]);
    for (const t of transfers) {
      balances.set(t.fromUserId, balances.get(t.fromUserId)! + t.amountMinor);
      balances.set(t.toUserId, balances.get(t.toUserId)! - t.amountMinor);
    }
    expect([...balances.values()].every((v) => v === 0)).toBe(true);
  });

  it('returns no payments when everyone is even', () => {
    expect(settleUp(new Map([['a', 0], ['b', 0]]))).toEqual([]);
  });
});
