/**
 * Declaration file for uuid module
 * Provides type definitions for the uuid package
 */

declare module 'uuid' {
  export function v4(): string;
  export function v4(options: any): string;
  export function v1(): string;
  export function v3(namespace: any, name: string): string;
  export function v5(namespace: any, name: string): string;
  export function validate(uuid: string): boolean;
  export function version(uuid: string): number;
}
