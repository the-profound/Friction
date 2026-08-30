export interface DropdownFilterPresentation<T extends string> {
  label: string;
  value: T;
  defaultValue: T;
  selectedLabel?: string;
  selectedOptionLabel?: string;
  showDefaultOptionLabel?: boolean;
}

/**
 * A filter is active when its value differs from the value that represents
 * the unfiltered/default state. The default is intentionally explicit so
 * filters do not need to use a magic "all" key.
 */
export function isDropdownFilterActive<T extends string>(
  value: T,
  defaultValue: T,
): boolean {
  return value !== defaultValue;
}

export function getDropdownFilterLabel<T extends string>({
  label,
  value,
  defaultValue,
  selectedLabel,
  selectedOptionLabel,
  showDefaultOptionLabel = false,
}: DropdownFilterPresentation<T>): string {
  if (!isDropdownFilterActive(value, defaultValue) && !showDefaultOptionLabel) return label;
  return selectedLabel ?? selectedOptionLabel ?? label;
}