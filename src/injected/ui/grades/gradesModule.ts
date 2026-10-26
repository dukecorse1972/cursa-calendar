import { safeSetInnerHTML, escapeHtml } from '../../utils/dom';
import { GradesSimulatorView } from './gradesSimulatorView';

export class GradesModule {
  private static instance: GradesModule | null = null;
  private overlayEl: HTMLElement | null = null;
  private isGradesViewActive: boolean = false;
  private observer: MutationObserver | null = null;
  private textElement: HTMLElement | null = null;
  private dropdownMenuEl: HTMLElement | null = null;
  private originalText: string = 'Calendar';
  private clickOutsideListener: ((e: MouseEvent) => void) | null = null;
  private cleanupCallbacks: Array<() => void> = [];

  public static getInstance(): GradesModule {
    if (!GradesModule.instance) {
      GradesModule.instance = new GradesModule();
    }
    return GradesModule.instance;
  }

  private constructor() {}

  public init(): void {
    // Clear any prior listeners if re-initializing
    this.cleanupListenersOnly();

    // 1. Remove any legacy separate button if it was added
    const oldBtn = document.getElementById('cursa-header-switcher-btn');
    if (oldBtn) oldBtn.remove();

    this.injectOverlayStyles();
    this.createOverlayContainer();
    this.transformCalendarLogoTextIntoDropdown();

    // 2. Periodic retry during initial Google Calendar SPA hydration
    let retries = 0;
    const retryInterval = setInterval(() => {
      retries++;
      const ok = this.transformCalendarLogoTextIntoDropdown();
      if (ok || retries >= 40) {
        clearInterval(retryInterval);
      }
    }, 250);
    this.cleanupCallbacks.push(() => clearInterval(retryInterval));

    // 3. Setup observation to keep brand text hooked across view updates
    this.setupObservation();

    // 4. Setup global capture phase click listener to intercept clicks on brand area
    this.setupGlobalCaptureClickListener();

    // 5. Setup keyboard shortcuts (<Esc> closes dropdown or returns to calendar)
    this.setupKeyboardShortcuts();
  }

  public isViewActive(): boolean {
    return this.isGradesViewActive;
  }

  public showGradesView(): void {
    this.isGradesViewActive = true;
    if (!this.overlayEl) {
      this.createOverlayContainer();
    }
    if (this.overlayEl) {
      this.overlayEl.style.display = 'flex';
      const content = this.overlayEl.querySelector('#cursa-grades-view-content') as HTMLElement;
      if (content) {
        GradesSimulatorView.getInstance().mount(content);
      }
    }
    this.updateBrandText();
    this.closeDropdownMenu();
  }

  public showCalendarView(): void {
    this.isGradesViewActive = false;
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    this.updateBrandText();
    this.closeDropdownMenu();
  }

  public toggleView(): void {
    if (this.isGradesViewActive) {
      this.showCalendarView();
    } else {
      this.showGradesView();
    }
  }

  private injectOverlayStyles(): void {
    const styleId = 'cursa-grades-module-styles';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }

    style.textContent = `
      #cursa-grades-view-overlay {
        position: fixed;
        top: 64px;
        left: 0;
        width: 100vw;
        height: calc(100vh - 64px);
        z-index: 99999;
        display: none;
        flex-direction: column;
        background: var(--gcal-bg, var(--gcal-background, #1f1f1f));
        color: var(--gcal-text, #e8eaed);
        box-sizing: border-box;
      }

      .cursa-grades-tabs-scroll {
        display: flex;
        align-items: center;
        gap: 10px;
        overflow-x: auto;
        flex-shrink: 0;
        min-height: 44px;
        padding-bottom: 4px;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      .cursa-grades-tabs-scroll::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }

      /* Clean dropdown styling */
      #cursa-brand-dropdown-menu {
        position: fixed !important;
        z-index: 9999999 !important;
        background: var(--gcal-surface, #ffffff) !important;
        color: var(--gcal-text, #1f1f1f) !important;
        border: 1px solid var(--gcal-border, #dadce0) !important;
        border-radius: 12px !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.08) !important;
        padding: 6px !important;
        min-width: 230px !important;
        font-family: 'Google Sans', Roboto, -apple-system, sans-serif !important;
        box-sizing: border-box !important;
        animation: cursaDropdownFade 0.15s ease-out !important;
      }

      @keyframes cursaDropdownFade {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .cursa-dd-menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13.5px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        transition: background-color 0.15s ease;
      }

      .cursa-dd-menu-item:hover:not(.active) {
        background: var(--gcal-surface-hover, rgba(0, 0, 0, 0.06));
      }

      .cursa-dd-menu-item.active {
        background: var(--gcal-selected, rgba(26, 115, 232, 0.12));
        color: var(--gcal-accent, #1a73e8);
        font-weight: 600;
      }

      /* Logo trigger styling matching Google Calendar's exact native brand typography */
      #cursa-brand-logo-trigger {
        display: inline-flex !important;
        align-items: center !important;
        gap: 2px !important;
        cursor: pointer !important;
        border-radius: 8px !important;
        padding: 1px 4px !important;
        margin-left: 2px !important;
        transition: background 0.15s ease !important;
        user-select: none !important;
        font-family: 'Product Sans', 'Google Sans', Roboto, Arial, sans-serif !important;
        font-size: 22px !important;
        line-height: 24px !important;
        font-weight: 400 !important;
        letter-spacing: normal !important;
        color: inherit !important;
      }

      .cursa-brand-text-label {
        font-family: inherit !important;
        font-size: inherit !important;
        line-height: inherit !important;
        font-weight: 400 !important;
        letter-spacing: inherit !important;
        color: inherit !important;
      }

      #cursa-brand-logo-trigger:hover {
        background: var(--gcal-surface-hover, rgba(0, 0, 0, 0.08)) !important;
      }
    `;
  }

  private createOverlayContainer(): void {
    const existing = document.getElementById('cursa-grades-view-overlay');
    if (existing) {
      this.overlayEl = existing;
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'cursa-grades-view-overlay';
    safeSetInnerHTML(
      overlay,
      `<div id="cursa-grades-view-content" style="width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column;"></div>`
    );

    document.body.appendChild(overlay);
    this.overlayEl = overlay;
  }

  /**
   * Resiliently finds the brand text element (e.g. "Calendar" or "Calendario")
   * in Google Calendar's top-left bar across all versions and locales.
   */
  public findCalendarTextElement(): { anchor: HTMLElement | null; textEl: HTMLElement } | null {
    if (typeof document === 'undefined') return null;

    // 0. If already hooked with our trigger ID
    const existing = document.getElementById('cursa-brand-logo-trigger');
    if (existing && document.body.contains(existing)) {
      return { anchor: existing.closest('a'), textEl: existing };
    }

    // 1. Scan candidates in the top-left area of the screen
    const headerCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'header *, div[role="banner"] *, #gb *, [role="navigation"] *, .gb_1c *, .gb_0c *'
      )
    );

    // Fallback if header container has no semantic tag
    if (headerCandidates.length === 0 && document.body) {
      headerCandidates.push(...Array.from(document.body.querySelectorAll<HTMLElement>('*')));
    }

    // Find leaf or innermost matching elements in top-left region (top < 90, left < 450)
    for (const el of headerCandidates) {
      // Exclude interactive elements that are not the brand title
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'BUTTON' ||
        el.getAttribute('role') === 'button' ||
        el.closest('button') ||
        el.closest('[role="button"][aria-label*="Menú" i]') ||
        el.closest('[role="button"][aria-label*="Menu" i]') ||
        el.closest('#injected-tab-capsule') ||
        el.closest('#gcal-header-academic-tabs')
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 90 && rect.left >= 0 && rect.left < 450 && rect.width > 0 && rect.height > 0) {
        const rawTxt = (el.textContent || '').replace('▾', '').trim();
        const txt = rawTxt.toLowerCase();

        if (txt === 'calendario' || txt === 'calendar' || txt === 'google calendar' || txt === 'calificaciones') {
          // Find the innermost child with the matching text
          let innermost: HTMLElement = el;
          for (const child of Array.from(el.querySelectorAll<HTMLElement>('*'))) {
            const cTxt = (child.textContent || '').replace('▾', '').trim().toLowerCase();
            if (cTxt === 'calendario' || cTxt === 'calendar' || cTxt === 'calificaciones') {
              innermost = child;
              break;
            }
          }
          const anchor = innermost.closest<HTMLElement>('a');
          return { anchor, textEl: innermost };
        }
      }
    }

    // 2. Fallback: Search anchors in top-left region
    const anchors = Array.from(
      document.querySelectorAll<HTMLElement>(
        'header a, div[role="banner"] a, #gb a, a[href*="calendar"], a[href="./"], a[href="/"]'
      )
    );
    for (const a of anchors) {
      const rect = a.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 90 && rect.left >= 0 && rect.left < 450 && rect.width > 0) {
        const textNodes = Array.from(a.querySelectorAll<HTMLElement>('span, div')).filter((s) => {
          const t = (s.textContent || '').replace('▾', '').trim();
          return t.length > 0 && s.children.length === 0;
        });
        if (textNodes.length > 0) {
          return { anchor: a, textEl: textNodes[textNodes.length - 1] };
        }
        return { anchor: a, textEl: a };
      }
    }

    return null;
  }

  /**
   * Transforms the "Calendar" / "Calendario" text next to the logo into the dropdown trigger.
   */
  public transformCalendarLogoTextIntoDropdown(): boolean {
    if (typeof document === 'undefined') return false;

    // Ensure no stray badge exists
    const oldBtn = document.getElementById('cursa-header-switcher-btn');
    if (oldBtn) oldBtn.remove();

    const result = this.findCalendarTextElement();
    if (!result) return false;

    const { anchor, textEl } = result;
    this.textElement = textEl;

    // Preserve original text (e.g. 'Calendario' or 'Calendar')
    const curTxt = (textEl.textContent || '').replace('▾', '').trim();
    if (curTxt && curTxt.toLowerCase() !== 'calificaciones') {
      this.originalText = curTxt;
    }

    textEl.id = 'cursa-brand-logo-trigger';
    textEl.style.cursor = 'pointer';
    textEl.style.userSelect = 'none';

    // Hook click listener directly on textEl (with guard against duplicates)
    if (textEl.getAttribute('data-cursa-click-bound') !== 'true') {
      textEl.setAttribute('data-cursa-click-bound', 'true');
      textEl.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.toggleDropdownMenu();
        },
        true
      );
    }

    // If anchor exists, also intercept clicks on anchor
    if (anchor && anchor.getAttribute('data-cursa-click-bound') !== 'true') {
      anchor.setAttribute('data-cursa-click-bound', 'true');
      anchor.style.cursor = 'pointer';
      anchor.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.toggleDropdownMenu();
        },
        true
      );
    }

    this.updateBrandText();
    return true;
  }

  private updateBrandText(): void {
    if (!this.textElement || !document.body.contains(this.textElement)) {
      const result = this.findCalendarTextElement();
      if (result) this.textElement = result.textEl;
    }
    if (!this.textElement) return;

    const label = this.isGradesViewActive ? 'Calificaciones' : this.originalText || 'Calendario';

    // Guard against infinite MutationObserver cycles
    const existingLabelSpan = this.textElement.querySelector<HTMLElement>('.cursa-brand-text-label');
    const existingChevron = this.textElement.querySelector<HTMLElement>('#cursa-brand-chevron');
    if (existingLabelSpan && existingChevron && existingLabelSpan.textContent === label) {
      return;
    }

    safeSetInnerHTML(
      this.textElement,
      `<span class="cursa-brand-text-label">${escapeHtml(label)}</span><span id="cursa-brand-chevron" style="font-size: 11px; opacity: 0.6; margin-left: 4px; display: inline-block; vertical-align: middle; transition: transform 0.2s ease;">▾</span>`
    );
  }

  public toggleDropdownMenu(): void {
    if (this.dropdownMenuEl) {
      this.closeDropdownMenu();
    } else {
      this.openDropdownMenu();
    }
  }

  public openDropdownMenu(): void {
    this.closeDropdownMenu();

    const trigger = this.textElement || document.getElementById('cursa-brand-logo-trigger');
    let top = 56;
    let left = 60;

    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom > 0 && rect.bottom < 150) {
        top = Math.round(rect.bottom + 6);
      }
      if (rect.left > 0 && rect.left < 500) {
        left = Math.round(rect.left);
      }
    }

    const menu = document.createElement('div');
    menu.id = 'cursa-brand-dropdown-menu';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    const isGrades = this.isGradesViewActive;

    safeSetInnerHTML(
      menu,
      `
      <div class="cursa-dd-menu-item ${!isGrades ? 'active' : ''}" data-target="calendar">
        <span style="font-size: 16px;">📅</span>
        <div style="flex: 1;">
          <div style="font-weight: 600;">Calendario</div>
          <div style="font-size: 11px; opacity: 0.7;">Clases, entregas y agenda</div>
        </div>
        ${!isGrades ? '<span style="font-size: 14px; font-weight: 700; color: var(--gcal-accent, #1a73e8);">✓</span>' : ''}
      </div>

      <div class="cursa-dd-menu-item ${isGrades ? 'active' : ''}" data-target="grades">
        <span style="font-size: 16px;">🧮</span>
        <div style="flex: 1;">
          <div style="font-weight: 600;">Calificaciones</div>
          <div style="font-size: 11px; opacity: 0.7;">Simulador de notas con IA</div>
        </div>
        ${isGrades ? '<span style="font-size: 14px; font-weight: 700; color: var(--gcal-accent, #1a73e8);">✓</span>' : ''}
      </div>
    `
    );

    // Click handler on menu items
    menu.querySelectorAll<HTMLElement>('.cursa-dd-menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const target = item.getAttribute('data-target');
        if (target === 'grades') {
          this.showGradesView();
        } else if (target === 'calendar') {
          this.showCalendarView();
        }
      });
    });

    document.body.appendChild(menu);
    this.dropdownMenuEl = menu;

    // Rotate chevron
    const chevron = document.getElementById('cursa-brand-chevron');
    if (chevron) {
      chevron.style.transform = 'rotate(180deg)';
    }

    // Click outside handler
    setTimeout(() => {
      this.clickOutsideListener = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
          target.closest('#cursa-brand-dropdown-menu') ||
          target.closest('#cursa-brand-logo-trigger') ||
          target.closest('#cursa-brand-chevron')
        ) {
          return;
        }
        this.closeDropdownMenu();
      };
      window.addEventListener('click', this.clickOutsideListener, true);
    }, 50);
  }

  public closeDropdownMenu(): void {
    if (this.clickOutsideListener) {
      window.removeEventListener('click', this.clickOutsideListener, true);
      this.clickOutsideListener = null;
    }
    if (this.dropdownMenuEl) {
      this.dropdownMenuEl.remove();
      this.dropdownMenuEl = null;
    }
    const chevron = document.getElementById('cursa-brand-chevron');
    if (chevron) {
      chevron.style.transform = 'none';
    }
  }

  private setupObservation(): void {
    if (this.observer) return;

    let debounceTimer: any = null;
    this.observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const trigger = document.getElementById('cursa-brand-logo-trigger');
        if (!trigger || !document.body.contains(trigger)) {
          this.transformCalendarLogoTextIntoDropdown();
        } else {
          this.updateBrandText();
        }
        // Ensure no legacy button exists
        const oldBtn = document.getElementById('cursa-header-switcher-btn');
        if (oldBtn) oldBtn.remove();
      }, 250);
    });

    if (document.body) {
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  private setupGlobalCaptureClickListener(): void {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // If click is inside the dropdown menu itself, let menu handlers process it
      if (target.closest('#cursa-brand-dropdown-menu')) {
        return;
      }

      // Direct hit on trigger or child
      if (
        target.closest('#cursa-brand-logo-trigger') ||
        target.id === 'cursa-brand-logo-trigger' ||
        target.closest('#cursa-brand-chevron') ||
        target.classList.contains('cursa-brand-text-label')
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.toggleDropdownMenu();
        return;
      }

      // Top-left header brand zone click interception (Y <= 70, X <= 380)
      if (e.clientY >= 0 && e.clientY < 70 && e.clientX >= 0 && e.clientX < 380) {
        // Exclude hamburger menu, today button, navigation arrows, academic capsule
        const isNavButton = target.closest(
          'button, [role="button"][aria-label*="Menú" i], [role="button"][aria-label*="Menu" i], [aria-label*="Hoy" i], [aria-label*="Today" i], [jsname="A5xsud"], .gcal-tabs-pill-box'
        );
        if (isNavButton) return;

        const txt = (target.textContent || '').trim().toLowerCase();
        const aria = (target.getAttribute('aria-label') || '').toLowerCase();
        const isBrand =
          txt.includes('calendario') ||
          txt.includes('calendar') ||
          txt.includes('calificaciones') ||
          aria.includes('calendario') ||
          aria.includes('calendar') ||
          target.closest('a[href*="calendar"]') ||
          target.closest('#cursa-brand-logo-trigger');

        if (isBrand) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.toggleDropdownMenu();
        }
      }
    };

    window.addEventListener('click', handleGlobalClick, true);
    this.cleanupCallbacks.push(() => window.removeEventListener('click', handleGlobalClick, true));
  }

  private setupKeyboardShortcuts(): void {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.dropdownMenuEl) {
          this.closeDropdownMenu();
          return;
        }
        if (this.isGradesViewActive) {
          const chatModal = document.querySelector('#cursa-grades-chat-modal-overlay');
          if (!chatModal) {
            e.preventDefault();
            this.showCalendarView();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    this.cleanupCallbacks.push(() => window.removeEventListener('keydown', handleKeydown));
  }

  private cleanupListenersOnly(): void {
    while (this.cleanupCallbacks.length > 0) {
      const fn = this.cleanupCallbacks.pop();
      try {
        if (fn) fn();
      } catch (_) {}
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  public destroy(): void {
    this.closeDropdownMenu();
    this.showCalendarView();
    this.cleanupListenersOnly();
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
      this.overlayEl = null;
    }
    GradesModule.instance = null;
  }
}
