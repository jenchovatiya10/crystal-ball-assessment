import type { GenerateStructuredParams, StreamParams } from "./types.js";

/**
 * Injectable AI backend. Knows nothing about Summary/Help/Teach services.
 */
export interface AIProvider {
  generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;

  stream(params: StreamParams): AsyncIterable<string>;
}
