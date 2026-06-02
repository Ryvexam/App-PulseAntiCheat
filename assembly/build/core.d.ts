declare namespace __AdaptedExports {
  /** Exported memory */
  export const memory: WebAssembly.Memory;
  /**
   * assembly/index/alloc
   * @param size `i32`
   * @returns `usize`
   */
  export function alloc(size: number): number;
  /**
   * assembly/index/free
   * @param ptr `usize`
   */
  export function free(ptr: number): void;
  /**
   * assembly/index/sha256
   * @param ptr `usize`
   * @param len `i32`
   * @returns `usize`
   */
  export function sha256(ptr: number, len: number): number;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;
