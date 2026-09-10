import '@testing-library/jest-dom/vitest';

/**
 * jsdom implements neither of the browser APIs the session feature depends on,
 * so both are stubbed here. Tests assert on how the app REACTS to camera and
 * socket states - they do not attempt to exercise real media pipelines.
 */

// navigator.mediaDevices is absent in jsdom.
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  writable: true,
  configurable: true,
  value: {
    getUserMedia: () =>
      Promise.reject(
        Object.assign(new Error('Permission denied'), {
          name: 'NotAllowedError',
        }),
      ),
    enumerateDevices: () => Promise.resolve([]),
  },
});

// canvas.toBlob is not implemented by jsdom.
if (!HTMLCanvasElement.prototype.toBlob) {
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new Blob([], { type: 'image/jpeg' }));
  };
}

// ResizeObserver is used by Recharts' ResponsiveContainer.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub;
}
