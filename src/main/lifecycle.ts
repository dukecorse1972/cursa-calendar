/**
 * Application Lifecycle State Management
 * Decouples quitting state from BrowserWindow management to break circular dependencies.
 */

let isQuitting = false;

export function setIsQuitting(val: boolean): void {
  isQuitting = val;
}

export function getIsQuitting(): boolean {
  return isQuitting;
}
