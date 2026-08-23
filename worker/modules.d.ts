/**
 * Wrangler turns these imports into real values at bundle time: a .wasm becomes
 * an instantiated-on-demand WebAssembly.Module, and a .bin becomes an
 * ArrayBuffer. TypeScript has no idea about either, so it needs telling.
 */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.bin" {
  const data: ArrayBuffer;
  export default data;
}
