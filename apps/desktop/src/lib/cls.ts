type ClassValue = string | number | null | undefined | false;

/** Tiny className combiner that ignores falsy values. */
export function cls(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
