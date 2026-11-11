if (!(globalThis as { window?: unknown }).window) {
  (globalThis as { window?: unknown }).window = globalThis;
}

