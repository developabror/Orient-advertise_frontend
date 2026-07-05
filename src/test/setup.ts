// Global Vitest setup, loaded via `test.setupFiles` in vite.config.ts and run
// once before every test file.
//
// - Pulls in @testing-library/jest-dom's custom matchers (toBeInTheDocument,
//   toHaveTextContent, …) and augments Vitest's `expect`.
// - Unmounts any rendered React tree after each test so DOM state and portals
//   (the Drawer renders through createPortal into document.body) don't leak
//   between cases.
import '@testing-library/jest-dom/vitest';
// Initialise the shared i18next instance so components rendered in tests resolve
// translation keys to real (English) text instead of echoing the raw key.
import '@/i18n/config';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
