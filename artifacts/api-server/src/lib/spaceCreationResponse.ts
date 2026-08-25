function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * `creationKey` is an internal retry key, never API response data. This is
 * recursive because space rows are also embedded in list and join responses.
 */
export function redactSpaceCreationKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSpaceCreationKeys);
  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "creationKey")
      .map(([key, nested]) => [key, redactSpaceCreationKeys(nested)]),
  );
}