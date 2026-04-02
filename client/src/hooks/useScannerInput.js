import { useEffect, useRef } from 'react';

export function useScannerInput(onScan, options = {}) {
  const { minLength = 4, timeout = 80, cooldown = 1200 } = options;
  const bufferRef = useRef('');
  const lastCharRef = useRef(0);
  const timeoutRef = useRef(null);
  const lastScanRef = useRef({ value: '', timestamp: 0 });

  useEffect(() => {
    const flush = () => {
      const value = bufferRef.current.trim();
      bufferRef.current = '';

      if (value.length < minLength) {
        return;
      }

      const now = Date.now();
      if (lastScanRef.current.value === value && now - lastScanRef.current.timestamp < cooldown) {
        return;
      }

      lastScanRef.current = { value, timestamp: now };
      onScan(value);
    };

    const handleKeyDown = (event) => {
      const activeTag = document.activeElement?.tagName;

      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        return;
      }

      const now = Date.now();

      if (event.key === 'Enter') {
        if (bufferRef.current) {
          flush();
        }
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      if (now - lastCharRef.current > timeout) {
        bufferRef.current = '';
      }

      bufferRef.current += event.key;
      lastCharRef.current = now;

      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(flush, timeout);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timeoutRef.current);
    };
  }, [cooldown, minLength, onScan, timeout]);
}
