// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The few web worker globals the worker files use, declared here because the
// project's `lib` stays ES2022, without DOM types. They are exported types,
// not ambient globals, so nothing outside the files that import them sees
// them; each of those files names the global it uses with a module-scoped
// `declare const` (`self` in entry-web.ts, `Worker` in web.ts). Only the
// members used are declared.
//
// This is a new-design file: project header only.

/** A `message`, `error` or `messageerror` event, as much of it as is read. */
export interface WebEvent {
  readonly data?: unknown;
  readonly message?: string;
  readonly error?: unknown;
}

/** A dedicated worker's global scope (`self` inside the worker). */
export interface WebWorkerScope {
  addEventListener(type: 'message', listener: (event: WebEvent) => void): void;
  postMessage(message: unknown): void;
}

/** A web `Worker`, from the page's side. */
export interface WebWorker {
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: WebEvent) => void): void;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  terminate(): void;
}

/** The `Worker` constructor. */
export interface WebWorkerConstructor {
  new (url: URL | string, options?: { type?: 'classic' | 'module'; name?: string }): WebWorker;
}
