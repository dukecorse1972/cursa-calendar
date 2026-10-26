import { safeSetInnerHTML } from '../utils/dom';

export const FULL_EDITOR_CLOSE_SELECTORS = [
  '#xPrCloseBu',
  'button[aria-label*="Descartar" i]',
  'button[aria-label*="Discard" i]',
  'button[aria-label*="Atrás" i]',
  'button[aria-label*="Back" i]',
  '[role="button"][aria-label*="Descartar" i]',
  '[role="button"][aria-label*="Discard" i]',
  '[role="button"][aria-label*="Atrás" i]',
  '[role="button"][aria-label*="Back" i]',
  '[data-action="discard"]',
  '[data-action="close"]',
  '.xPrCloseBu',
  '[jsname="xPrCloseBu"]'
];

/**
 * Controller ensuring the user can ALWAYS exit Google Calendar's full event editor (/r/eventedit/).
 * Hooks directly into Google Calendar's own original close/discard button ('✕' / Descartar cambios),
 * uses global click capture, position-based heuristics, and keyboard shortcuts (Esc / Alt+←)
 * to guarantee that clicking '✕' or pressing Esc instantly returns to the calendar grid (/r).
 */
export class FullEditorNavigation {
  private static instance: FullEditorNavigation | null = null;
  private fallbackCloseBtn: HTMLElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickCaptureHandler: ((e: MouseEvent) => void) | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private isObserving = false;

  public static getInstance(): FullEditorNavigation {
    if (!FullEditorNavigation.instance) {
      FullEditorNavigation.instance = new FullEditorNavigation();
    }
    return FullEditorNavigation.instance;
  }

  private constructor() {}

  public init(): void {
    this.update();

    if (!this.isObserving && typeof window !== 'undefined') {
      this.isObserving = true;
      window.addEventListener('popstate', () => this.update());
      window.addEventListener('hashchange', () => this.update());

      // Monitor SPA route transitions and DOM rendering
      this.checkInterval = setInterval(() => {
        this.update();
      }, 350);

      // Global capture click listener for all close / discard triggers in full editor
      this.clickCaptureHandler = (e: MouseEvent) => {
        if (!this.isFullEditorActive()) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;

        if (this.isCloseButtonTarget(target)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.returnToCalendar();
        }
      };
      window.addEventListener('click', this.clickCaptureHandler, true);

      // Keyboard shortcuts: Esc or Alt + ArrowLeft cleanly and infallibly exits the editor
      this.keydownHandler = (e: KeyboardEvent) => {
        if (!this.isFullEditorActive()) return;

        if (e.key === 'Escape' || ((e.altKey || e.metaKey) && e.key === 'ArrowLeft')) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.returnToCalendar();
        }
      };
      window.addEventListener('keydown', this.keydownHandler, true);
    }
  }

  public isFullEditorActive(): boolean {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    return path.includes('/r/eventedit') || path.includes('/eventedit');
  }

  public update(): void {
    if (this.isFullEditorActive()) {
      this.setupNativeCloseButton();
    } else {
      this.dismountFallbackButton();
    }
  }

  /**
   * Determines whether an element or any of its ancestors represents the editor's close/discard button.
   * Combines explicit selectors, semantic ARIA labels, and top-left header geometry.
   */
  public isCloseButtonTarget(target: HTMLElement): boolean {
    // 1. Explicit ID or class matches
    if (
      target.closest('#xPrCloseBu') ||
      target.closest('#gcal-native-close-btn') ||
      target.closest('[data-action="discard"]') ||
      target.closest('[data-action="close"]') ||
      target.closest('.xPrCloseBu')
    ) {
      return true;
    }

    // 2. Semantic ARIA text
    const ariaEl = target.closest<HTMLElement>('[aria-label], [title], [data-tooltip]');
    if (ariaEl) {
      const ariaText = (
        (ariaEl.getAttribute('aria-label') || '') + ' ' +
        (ariaEl.getAttribute('title') || '') + ' ' +
        (ariaEl.getAttribute('data-tooltip') || '')
      ).toLowerCase();

      if (
        ariaText.includes('descartar') ||
        ariaText.includes('discard') ||
        ariaText.includes('atrás') ||
        ariaText.includes('back') ||
        (ariaText.includes('cerrar') && !ariaText.includes('menú') && !ariaText.includes('menu'))
      ) {
        return true;
      }
    }

    // 3. Top-left header button geometry heuristic (where Google Calendar places the native ✕ button)
    const btn = target.closest<HTMLElement>('button, [role="button"], div[jsname], div[data-tooltip]');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 85 && rect.left >= 0 && rect.left < 95 && rect.width > 0 && rect.width < 65) {
        return true;
      }
    }

    return false;
  }

  /**
   * Finds Google Calendar's native close/discard button in the full editor.
   */
  public findNativeCloseButton(): HTMLElement | null {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;

    for (const selector of FULL_EDITOR_CLOSE_SELECTORS) {
      try {
        const el = document.querySelector<HTMLElement>(selector);
        if (el && el.id !== 'gcal-native-close-btn') {
          return el;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Integrates with Google Calendar's own original close button.
   * If Google Calendar's native button is present, dismounts any fallback button.
   * If not yet mounted in the DOM, renders an authentic Google-styled circular '✕' button.
   */
  public setupNativeCloseButton(): void {
    if (typeof document === 'undefined') return;

    const nativeBtn = this.findNativeCloseButton();
    if (nativeBtn) {
      this.dismountFallbackButton();
      return;
    }

    // If native button is not yet rendered in DOM, mount fallback Google-styled circular ✕ button
    this.mountFallbackButton();
  }

  public mountFallbackButton(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('gcal-native-close-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'gcal-native-close-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Descartar cambios');
    btn.setAttribute('title', 'Descartar cambios');
    btn.style.cssText = `
      position: fixed;
      top: 10px;
      left: 14px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--gcal-secondary-text, #5f6368);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483640;
      transition: background-color 0.15s ease, color 0.15s ease;
      outline: none;
    `;

    safeSetInnerHTML(
      btn,
      `
      <svg focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
      </svg>
    `
    );

    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = 'var(--gcal-surface-hover, rgba(60, 64, 67, 0.08))';
      btn.style.color = 'var(--gcal-text, #202124)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = 'transparent';
      btn.style.color = 'var(--gcal-secondary-text, #5f6368)';
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.returnToCalendar();
    });

    document.body.appendChild(btn);
    this.fallbackCloseBtn = btn;
  }

  public dismountFallbackButton(): void {
    if (this.fallbackCloseBtn) {
      this.fallbackCloseBtn.remove();
      this.fallbackCloseBtn = null;
    }
    const existing = document.getElementById('gcal-native-close-btn');
    if (existing) {
      existing.remove();
    }
    const oldNavbar = document.getElementById('cursa-eventedit-navbar');
    if (oldNavbar) {
      oldNavbar.remove();
    }
  }

  public returnToCalendar(): void {
    if (typeof window === 'undefined') return;

    this.dismountFallbackButton();

    const match = window.location.pathname.match(/\/calendar\/u\/(\d+)/);
    const accountIndex = match ? match[1] : '0';
    const mainCalendarUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r`;

    // Direct, infallible navigation back to main calendar view
    window.location.href = mainCalendarUrl;
  }

  public destroy(): void {
    this.dismountFallbackButton();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.keydownHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    if (this.clickCaptureHandler && typeof window !== 'undefined') {
      window.removeEventListener('click', this.clickCaptureHandler, true);
      this.clickCaptureHandler = null;
    }
    this.isObserving = false;
    FullEditorNavigation.instance = null;
  }
}
