/**
 * Global test preload for Bun test runner.
 *
 * Loaded before every test file via bunfig.toml [test].preload.
 * Registers happy-dom globals (document, window, etc.) and
 * extends expect() with jest-dom matchers (toBeInTheDocument, etc.).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "@testing-library/jest-dom";

GlobalRegistrator.register();
