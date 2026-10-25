import { ThemeMode, ThemeTokens } from '../../shared/types';
import { getTokens } from './tokens';

export class ThemeManager {
  private static instance: ThemeManager | null = null;
  private currentMode: ThemeMode = 'LIGHT';
  private listeners: Set<(mode: ThemeMode, tokens: ThemeTokens) => void> = new Set();
  private observer: MutationObserver | null = null;
  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  private constructor() {
    this.currentMode = this.detectCurrentTheme();
  }

  public init(): void {
    this.currentMode = this.detectCurrentTheme();
    this.applyCssVariables();

    // 1. Observe DOM attributes on documentElement and body
    if (!this.observer) {
      this.observer = new MutationObserver(() => {
        const detected = this.detectCurrentTheme();
        if (detected !== this.currentMode) {
          this.setTheme(detected);
        }
      });

      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-color-mode', 'style']
      });

      if (document.body) {
        this.observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['class', 'style']
        });
      }
    }

    // 2. Observe system color scheme
    if (!this.mediaQuery && typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaListener = () => {
        const detected = this.detectCurrentTheme();
        if (detected !== this.currentMode) {
          this.setTheme(detected);
        }
      };
      this.mediaQuery.addEventListener('change', this.mediaListener);
    }
  }

  public detectCurrentTheme(): ThemeMode {
    try {
      // 1. Check data attributes & classes
      const root = document.documentElement;
      const body = document.body;

      const isDarkAttr =
        root.getAttribute('data-theme') === 'dark' ||
        root.getAttribute('data-color-mode') === 'dark' ||
        root.classList.contains('dark') ||
        (body && body.classList.contains('dark'));

      if (isDarkAttr) {
        return 'DARK';
      }

      // 2. Check computed background color
      const targetElement = body || root;
      if (targetElement) {
        const bg = window.getComputedStyle(targetElement).backgroundColor;
        const rgbMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1], 10);
          const g = parseInt(rgbMatch[2], 10);
          const b = parseInt(rgbMatch[3], 10);
          // Perceived luminance formula
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luminance < 120) {
            return 'DARK';
          }
        }
      }

      // 3. Fallback to prefers-color-scheme
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'DARK';
      }
    } catch {
      // Default to LIGHT on any error
    }

    return 'LIGHT';
  }

  public getTheme(): ThemeMode {
    return this.currentMode;
  }

  public getTokens(): ThemeTokens {
    return getTokens(this.currentMode);
  }

  public setTheme(mode: ThemeMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.applyCssVariables();
    const tokens = this.getTokens();
    this.listeners.forEach((listener) => {
      try {
        listener(mode, tokens);
      } catch (err) {
        console.error('[ThemeManager] Listener error:', err);
      }
    });
  }

  public onThemeChange(listener: (mode: ThemeMode, tokens: ThemeTokens) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyCssVariables(): void {
    const tokens = this.getTokens();
    const root = document.documentElement;
    root.style.setProperty('--gcal-bg', tokens.background);
    root.style.setProperty('--gcal-background', tokens.background);
    root.style.setProperty('--gcal-surface', tokens.surface);
    root.style.setProperty('--gcal-surface-hover', tokens.surfaceHover);
    root.style.setProperty('--gcal-border', tokens.border);
    root.style.setProperty('--gcal-text', tokens.text);
    root.style.setProperty('--gcal-secondary-text', tokens.secondaryText);
    root.style.setProperty('--gcal-accent', tokens.accent);
    root.style.setProperty('--gcal-selected', tokens.selected);
    root.style.setProperty('--gcal-disabled', tokens.disabled);
  }

  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.mediaQuery && this.mediaListener) {
      this.mediaQuery.removeEventListener('change', this.mediaListener);
      this.mediaQuery = null;
      this.mediaListener = null;
    }
    this.listeners.clear();
    ThemeManager.instance = null;
  }
}
