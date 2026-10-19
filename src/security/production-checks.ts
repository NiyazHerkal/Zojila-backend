/**
 * Refuses to start a production server with settings that are only safe in development.
 * Throws with every problem listed, so they can all be fixed in one go.
 */

// The secrets committed in .env.example: anyone with the repo could forge tokens signed with them.
const EXAMPLE_SECRETS = new Set([
  'ecbe9a9a5eed86fec86a6779d09ab9b379039d26fcc8f28cfcce7fe5d428911a',
  '7b667e83eda35464b43a303b0524f1610a011c459675c236053808129bf59ffe',
]);
const MIN_SECRET_LENGTH = 32;

export function productionProblems(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const access = env.JWT_ACCESS_SECRET ?? '';
  const refresh = env.JWT_REFRESH_SECRET ?? '';
  for (const [name, value] of [['JWT_ACCESS_SECRET', access], ['JWT_REFRESH_SECRET', refresh]] as const) {
    if (value.length < MIN_SECRET_LENGTH) problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
    if (EXAMPLE_SECRETS.has(value)) problems.push(`${name} is the example value from .env.example; generate a new one`);
  }
  if (access && access === refresh) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  if (env.RATE_LIMIT_DISABLED === 'true') problems.push('RATE_LIMIT_DISABLED must not be true in production');
  const opsKey = env.OPS_API_KEY?.trim();
  if (opsKey && opsKey.length < MIN_SECRET_LENGTH) problems.push(`OPS_API_KEY must be at least ${MIN_SECRET_LENGTH} characters`);
  return problems;
}

export function assertProductionReady(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionProblems(env);
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
