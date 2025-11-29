import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

type SetStateArg = string | null | ((prev: string | null) => string | null);

export function useSearchParamValue(
  key: string,
  options?: { debounceMs?: number }
): [string | null, (next: SetStateArg) => void] {
  const debounceMs = options?.debounceMs ?? 300;
  const [searchParams, setSearchParams] = useSearchParams();

  const initialValue = useMemo(() => {
    const value = searchParams.get(key);
    return value !== null ? value : null;
  }, [key, searchParams]);

  const [currentValue, setCurrentValue] = useState<string | null>(initialValue);

  // Keep local state in sync if the URL changes externally
  useEffect(() => {
    if (initialValue !== currentValue) {
      setCurrentValue(initialValue);
    }
  }, [initialValue, currentValue]);

  const timeoutRef = useRef<number | null>(null);

  const applyToUrl = useCallback(
    (value: string | null) => {
      const nextParams = new URLSearchParams(searchParams);
      if (value === null || value === "") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [key, searchParams, setSearchParams]
  );

  const setValue = useCallback(
    (next: SetStateArg) => {
      setCurrentValue((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: string | null) => string | null)(prev)
            : next;

        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
          applyToUrl(resolved);
          timeoutRef.current = null;
        }, debounceMs);

        return resolved;
      });
    },
    [applyToUrl, debounceMs]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [currentValue, setValue];
}
