// esbuild replaces this constant once per build, never once per process start.
declare const __HWD_BUILD_ID__: string;
export const BUILD_ID = typeof __HWD_BUILD_ID__ === "undefined"
  ? "development-unbundled" : __HWD_BUILD_ID__;
