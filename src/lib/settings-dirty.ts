export function collectDirtySettingsSections<T extends object, K extends keyof T>(
  current: T,
  saved: T,
  sections: readonly K[],
  forcedDirty: Iterable<K> = [],
) {
  const dirty = new Set<K>(forcedDirty);
  for (const section of sections) {
    if (JSON.stringify(current[section]) !== JSON.stringify(saved[section])) {
      dirty.add(section);
    }
  }
  return dirty;
}
