import { Transform } from 'class-transformer';

/**
 * Treats an empty/whitespace-only string as "not provided". Clients (Postman, some form
 * libraries) routinely send `""` for an omitted optional field instead of leaving it out —
 * without this, `""` reaches the DB as a real value in a unique nullable column (only `null`
 * is exempt from a unique constraint), so a second "not provided" signup collides with the first.
 */
export function EmptyToUndefined() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );
}
