import { productionProblems } from './production-checks.js';

describe('production start-up checks', () => {
  const strong = (c: string) => c.repeat(48);

  it('ignores non-production environments', () => {
    expect(productionProblems({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('rejects missing, short, example or identical JWT secrets', () => {
    expect(productionProblems({ NODE_ENV: 'production' })).toHaveLength(2);
    const example = productionProblems({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'ecbe9a9a5eed86fec86a6779d09ab9b379039d26fcc8f28cfcce7fe5d428911a',
      JWT_REFRESH_SECRET: strong('b'),
    });
    expect(example).toEqual(['JWT_ACCESS_SECRET is the example value from .env.example; generate a new one']);
    expect(productionProblems({ NODE_ENV: 'production', JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('a') })).toEqual([
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    ]);
  });

  it('rejects disabled rate limits, and passes a good config', () => {
    const good = { NODE_ENV: 'production', JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b') };
    expect(productionProblems(good)).toEqual([]);
    expect(productionProblems({ ...good, RATE_LIMIT_DISABLED: 'true' })).toHaveLength(1);
  });
});
