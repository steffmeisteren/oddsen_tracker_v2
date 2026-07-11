import { useCallback, useEffect, useState } from 'react';

type StoredValue<T> = {
  version: 1;
  value: T;
};

function readValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredValue<T> | T;
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && 'value' in parsed) {
      return parsed.value;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function useLocalStorage<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readValue(key, fallback));

  useEffect(() => {
    try {
      const stored: StoredValue<T> = { version: 1, value };
      window.localStorage.setItem(key, JSON.stringify(stored));
    } catch {
      // Storage can be unavailable in private browsing or when the quota is full.
    }
  }, [key, value]);

  const reset = useCallback(() => {
    window.localStorage.removeItem(key);
    setValue(fallback);
  }, [fallback, key]);

  return [value, setValue, reset] as const;
}

export function clearKampinnsiktStorage(): void {
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith('kampinnsikt:'))
    .forEach((key) => window.localStorage.removeItem(key));
}
