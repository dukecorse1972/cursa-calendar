import { AppTab } from '../../shared/types';
import { AppState } from '../state';
import { GoogleCalendarAdapter } from '../adapter/GoogleCalendarAdapter';
import { CreatorModal } from './creatorModal';
import { AcademicDetailModal } from './detailModal';
import { OnboardingModal } from './onboardingModal';
import { safeSetInnerHTML } from '../utils/dom';
import { getIsolatedItem } from '../utils/storage';
import { t } from '../../shared/i18n';

/**
 * Pure helper determining whether global academic keyboard shortcuts (1, 2, 3, j, k, Ctrl+,)
 * must be suppressed because focus is inside an editable input or an academic modal is open.
 */
export function shouldSuppressAcademicShortcut(
  activeEl: { tagName?: string; getAttribute?: (attr: string) => string | null; closest?: (sel: string) => Element | null } | null,
  doc?: { querySelector?: (sel: string) => Element | null } | null
): boolean {
  const tag = (activeEl?.tagName || '').toUpperCase();
  const isEditableTag = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const isRoleTextbox = activeEl?.getAttribute?.('role') === 'textbox';
  const isContentEditable = activeEl?.getAttribute?.('contenteditable') === 'true';
  const isInsideModal = Boolean(
    activeEl?.closest?.('#gcal-academic-creator-modal') ||
    activeEl?.closest?.('#gcal-academic-detail-modal') ||
    activeEl?.closest?.('#gcal-onboarding-modal-overlay') ||
    activeEl?.closest?.('#cursa-grades-chat-modal-overlay')
  );

  if (isEditableTag || isRoleTextbox || isContentEditable || isInsideModal) {
    return true;
  }

  if (doc && typeof doc.querySelector === 'function') {
    const creatorEl = doc.querySelector('#gcal-academic-creator-modal');
    const isCreatorOpen = Boolean(creatorEl && creatorEl.getAttribute('style')?.includes('display: flex'));
    const isDetailOpen = Boolean(doc.querySelector('#gcal-academic-detail-modal'));
    const isOnboardingOpen = Boolean(doc.querySelector('#gcal-onboarding-modal-overlay'));
    if (isCreatorOpen || isDetailOpen || isOnboardingOpen) {
      return true;
    }
  }

  return false;
}

export class AcademicPanel {
  private static instance: AcademicPanel | null = null;
  private headerTabsContainer: HTMLElement | null = null;
  private unsubscribeState: (() => void) | null = null;
  private observer: MutationObserver | null = null;
  private removeEventListeners: (() => void) | null = null;
  private lastNavTime = 0;

  public static getInstance(): AcademicPanel {
    if (!AcademicPanel.instance) {
      AcademicPanel.instance = new AcademicPanel();
    }
    return AcademicPanel.instance;
  }

  private constructor() {}

  public init(): void {
    // 1. Inject fluid tab styles
    this.injectFluidTabStyles();

    // 2. Mount tabs in top header
    const mounted = this.mountInTopHeader();

    // If header is not in DOM yet (initial SPA hydration), retry periodically until mounted
    if (!mounted) {
      let retryCount = 0;
      const retryInterval = setInterval(() => {
        retryCount++;
        const ok = this.mountInTopHeader();
        if (ok || retryCount >= 40) {
          clearInterval(retryInterval);
        }
      }, 250);

      const prevRemover = this.removeEventListeners;
      this.removeEventListeners = () => {
        if (prevRemover) prevRemover();
        clearInterval(retryInterval);
      };
    }

    // 3. Setup observation to keep tabs mounted through Google Calendar SPA updates
    this.setupObservation();

    // 4. Setup interception on Google Calendar's native "+ Crear" button
    this.setupCreateButtonInterception();

    // 5. Setup keyboard navigation between weeks with < and > / ArrowLeft and ArrowRight
    this.setupKeyboardNavigation();

    // 6. Setup interception on academic event chips to open custom extended view
    this.setupEventChipClickInterception();

    // 7. Setup injection inside Google's native Settings gear menu
    this.setupSettingsMenuInterception();

    // 7. Subscribe to state updates
    const appState = AppState.getInstance();
    this.unsubscribeState = appState.subscribe((state) => {
      this.updateActiveTabStyles(state.activeTab);
      GoogleCalendarAdapter.getInstance().applyTabFilter(state.activeTab, true);
    });

    // 8. Initial render and filter
    const initialState = appState.getState();
    this.updateActiveTabStyles(initialState.activeTab);
    GoogleCalendarAdapter.getInstance().applyTabFilter(initialState.activeTab, true);

    // 9. Trigger first-time onboarding wizard only if neither completed nor subjects already configured [P1-02]
    const hasCompleted = getIsolatedItem('gcal_academic_onboarding_completed') === 'true';
    const hasSubjects = Boolean(getIsolatedItem('gcal_academic_subjects'));
    if (!hasCompleted && !hasSubjects) {
      setTimeout(() => {
        OnboardingModal.getInstance().open();
      }, 700);
    }
  }

  private injectFluidTabStyles(): void {
    const styleId = 'gcal-custom-fluid-tab-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .gcal-tabs-pill-box {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin: 0 12px;
          padding: 3px 6px;
          background: var(--gcal-surface, rgba(255, 255, 255, 0.08));
          border: 1px solid var(--gcal-border, rgba(255, 255, 255, 0.15));
          border-radius: 20px;
          font-family: 'Google Sans', Roboto, Arial, sans-serif;
          box-sizing: border-box;
          vertical-align: middle;
          flex-shrink: 0;
          z-index: 1000;
          transition: background 0.25s ease, border-color 0.25s ease;
        }

        .gcal-tab-icon {
          font-size: 13px;
          margin: 0 4px 0 2px;
          user-select: none;
        }

        .gcal-hdr-tab-btn {
          padding: 5px 12px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--gcal-secondary-text, #9aa0a6);
          font-weight: 600;
          font-size: 12px;
          border-radius: 14px;
          cursor: pointer;
          user-select: none;
          outline: none;
          transition: background 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                      color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                      border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                      transform 0.15s ease,
                      box-shadow 0.2s ease;
        }

        .gcal-hdr-tab-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--gcal-primary-text, #e8eaed);
          transform: translateY(-1px);
        }

        .gcal-hdr-tab-btn:active {
          transform: scale(0.96);
        }

        .gcal-hdr-tab-btn.active {
          border-color: var(--gcal-accent, #8ab4f8) !important;
          background: var(--gcal-selected, #004a77) !important;
          color: var(--gcal-accent, #8ab4f8) !important;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
        }

        #gcal-academic-settings-menuitem {
          transition: background-color 0.15s ease, color 0.15s ease;
          cursor: pointer !important;
        }

        #gcal-academic-settings-menuitem:hover {
          background-color: var(--gcal-surface-hover, rgba(0, 0, 0, 0.06)) !important;
          color: var(--gcal-accent, #1a73e8) !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Discovers the optimal insertion point in Google Calendar's top bar
   * using a prioritized cascade of modern and legacy selectors.
   */
  private findHeaderMountTarget(): { container: HTMLElement; referenceNode: HTMLElement | null } | null {
    // Strategy 1: Google Bar middle container via .gb_v (modern Google Calendar)
    const gbV = document.querySelector<HTMLElement>('.gb_v');
    if (gbV && gbV.parentElement) {
      return { container: gbV.parentElement, referenceNode: gbV };
    }

    // Strategy 2: Legacy OneGoogleBar container .gb_ae
    const gbAe = document.querySelector<HTMLElement>('.gb_ae');
    if (gbAe) {
      const ref = gbV && gbV.parentElement === gbAe ? gbV : null;
      return { container: gbAe, referenceNode: ref };
    }

    // Strategy 3: Header search bar wrapper
    const searchInput = document.querySelector<HTMLElement>('header input[type="text"], header form');
    if (searchInput) {
      const searchWrapper =
        searchInput.closest<HTMLElement>('header > div > div') ||
        searchInput.closest<HTMLElement>('header > div');
      if (searchWrapper && searchWrapper.parentElement) {
        return { container: searchWrapper.parentElement, referenceNode: searchWrapper };
      }
    }

    // Strategy 4: Settings or Help button container
    const settingsBtn = document.querySelector<HTMLElement>(
      'header button[aria-label*="Configuración" i], header button[aria-label*="Settings" i], header button[aria-label*="Ayuda" i], header button[aria-label*="Help" i]'
    );
    if (settingsBtn) {
      const btnWrapper = settingsBtn.closest<HTMLElement>('header > div');
      if (btnWrapper && btnWrapper.parentElement) {
        return { container: btnWrapper.parentElement, referenceNode: btnWrapper };
      }
    }

    // Strategy 5: Semantic header / banner fallback
    const header =
      document.querySelector<HTMLElement>('header') ||
      document.querySelector<HTMLElement>('div[role="banner"]');
    if (header) {
      const middleOrFirst =
        (header.children[1] as HTMLElement) ||
        (header.children[0] as HTMLElement) ||
        header;
      return { container: middleOrFirst, referenceNode: null };
    }

    return null;
  }

  public mountInTopHeader(): boolean {
    const target = this.findHeaderMountTarget();
    if (!target || !target.container) return false;

    if (!this.headerTabsContainer) {
      this.headerTabsContainer = document.createElement('div');
      this.headerTabsContainer.id = 'gcal-header-academic-tabs';
      this.headerTabsContainer.className = 'gcal-tabs-pill-box';

      safeSetInnerHTML(
        this.headerTabsContainer,
        `
        <span class="gcal-tab-icon">🎓</span>
        <button id="gcal-hdr-tab-clases" type="button" class="gcal-hdr-tab-btn" data-tab="CLASES">${t('tab_clases')}</button>
        <button id="gcal-hdr-tab-entregas" type="button" class="gcal-hdr-tab-btn" data-tab="ENTREGAS_EXAMENES">${t('tab_entregas')}</button>
        <button id="gcal-hdr-tab-todo" type="button" class="gcal-hdr-tab-btn" data-tab="TODO">${t('tab_todo')}</button>
        `
      );

      const appState = AppState.getInstance();
      const tabClases = this.headerTabsContainer.querySelector('#gcal-hdr-tab-clases');
      const tabEntregas = this.headerTabsContainer.querySelector('#gcal-hdr-tab-entregas');
      const tabTodo = this.headerTabsContainer.querySelector('#gcal-hdr-tab-todo');

      tabClases?.addEventListener('click', (e) => {
        e.stopPropagation();
        appState.setActiveTab('CLASES');
      });
      tabEntregas?.addEventListener('click', (e) => {
        e.stopPropagation();
        appState.setActiveTab('ENTREGAS_EXAMENES');
      });
      tabTodo?.addEventListener('click', (e) => {
        e.stopPropagation();
        appState.setActiveTab('TODO');
      });
    }

    if (!target.container.contains(this.headerTabsContainer)) {
      if (target.referenceNode && target.referenceNode.parentElement === target.container) {
        target.container.insertBefore(this.headerTabsContainer, target.referenceNode);
      } else {
        target.container.appendChild(this.headerTabsContainer);
      }
      this.updateActiveTabStyles(AppState.getInstance().getState().activeTab);
    }

    // Clean up any legacy or misplaced settings button from header to ensure pristine native layout
    const oldBtn = document.getElementById('gcal-academic-settings-btn');
    if (oldBtn) {
      oldBtn.remove();
    }

    return true;
  }

  private updateActiveTabStyles(activeTab: AppTab): void {
    if (!this.headerTabsContainer) return;

    const tabClases = this.headerTabsContainer.querySelector('#gcal-hdr-tab-clases');
    const tabEntregas = this.headerTabsContainer.querySelector('#gcal-hdr-tab-entregas');
    const tabTodo = this.headerTabsContainer.querySelector('#gcal-hdr-tab-todo');

    const updateBtn = (btn: Element | null, tab: AppTab) => {
      if (!btn) return;
      if (activeTab === tab) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    };

    updateBtn(tabClases, 'CLASES');
    updateBtn(tabEntregas, 'ENTREGAS_EXAMENES');
    updateBtn(tabTodo, 'TODO');
  }

  /**
   * Intercepts Google Calendar's native "+ Crear" button:
   * - In EXÁMENES Y ENTREGAS: opens the custom academic creator modal.
   * - In CLASES and TODO: allows Google Calendar's standard native creation menu to open normally.
   */
  private setupCreateButtonInterception(): void {
    const handleCreateEvent = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Check if event occurred inside the "+ Crear" button or dropdown "Evento" item
      const createBtn = target.closest('button[jsname="todz4c"], .nUt0vb, .dwlvNd button');
      const menuItem = target.closest('[role="menuitem"]');
      const isEventMenuItem = Boolean(
        menuItem && menuItem.textContent?.toLowerCase().includes('evento')
      );

      if (createBtn || isEventMenuItem) {
        const activeTab = AppState.getInstance().getState().activeTab;
        if (activeTab === 'ENTREGAS_EXAMENES') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          if (e.type === 'click') {
            // Dismiss native dropdown menu if any was open
            document.body.click();
            CreatorModal.getInstance().open();
          }
        }
        // When activeTab is CLASES or TODO, do nothing -> native Google Calendar menu opens normally
      }
    };

    // Capture on window level so we evaluate before Google Calendar's jsaction delegated handlers
    const eventTypes = ['pointerdown', 'mousedown', 'click'];
    eventTypes.forEach((type) => {
      window.addEventListener(type, handleCreateEvent, true);
    });

    const prevRemover = this.removeEventListeners;
    this.removeEventListeners = () => {
      if (prevRemover) prevRemover();
      eventTypes.forEach((type) => {
        window.removeEventListener(type, handleCreateEvent, true);
      });
    };
  }

  /**
   * Intercepts clicks on event chips in the EXÁMENES Y ENTREGAS tab:
   * - Suppresses Google Calendar's native extended popover/dialog.
   * - Opens our custom academic extended view with full organization, bento metrics,
   *   notes editing and fast deletion.
   */
  private setupEventChipClickInterception(): void {
    const handleChipClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Don't intercept if clicking inside our custom modals or tab bar
      if (
        target.closest('#gcal-academic-detail-modal') ||
        target.closest('#gcal-academic-creator-modal') ||
        target.closest('#gcal-tab-selector') ||
        target.closest('.gcal-tabs-pill-box')
      ) {
        return;
      }

      // Find if an event chip or its inner card was clicked
      const chip = target.closest<HTMLElement>('[data-eventchip]');
      if (!chip) return;

      const activeTab = AppState.getInstance().getState().activeTab;
      const hasCustomAcademic = Boolean(chip.querySelector('.custom-academic-container'));
      const isAcademicText = /\[?(EXAMEN|ENTREGA)\]?|calendario:\s*[^,]*(exam|ent[er]gra)|entrega|entegra|ex[aá]men|exam|parcial|control|quiz|deadline|assignment|due|klausur|pr[üu]fung|devoir/i.test(chip.textContent || '');

      if (activeTab === 'ENTREGAS_EXAMENES' || hasCustomAcademic || isAcademicText) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.type === 'click') {
          AcademicDetailModal.getInstance().open(chip);
        }
      }
    };

    // Capture on window level so we evaluate before Google Calendar's internal handlers
    const eventTypes = ['pointerdown', 'mousedown', 'click'];
    eventTypes.forEach((type) => {
      window.addEventListener(type, handleChipClick as any, true);
    });

    const prevRemover = this.removeEventListeners;
    this.removeEventListeners = () => {
      if (prevRemover) prevRemover();
      eventTypes.forEach((type) => {
        window.removeEventListener(type, handleChipClick as any, true);
      });
    };
  }

  /**
   * Sets up bulletproof navigation between weeks:
   * - Allows Google Calendar's native header arrow buttons (< and >) to handle mouse clicks cleanly without interference.
   * - Intercepts keyboard navigation (< and >, ArrowLeft and ArrowRight, , and .) debounced to 350ms.
   * - Ensures navigation strictly advances/retreats 1 week at a time (never skips 2 weeks).
   */
  private setupKeyboardNavigation(): void {
    const handleKeyNavigation = (e: KeyboardEvent) => {
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (shouldSuppressAcademicShortcut(activeEl, typeof document !== 'undefined' ? document : null)) {
        return;
      }

      // Universal shortcut Ctrl+, (or Cmd+,) to open settings in edit mode
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        OnboardingModal.getInstance().open(true);
        return;
      }

      // Ignore if modifier keys (Ctrl, Alt, Meta) are held down
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Shortcuts 1, 2, 3 for switching academic tabs
      if (e.key === '1') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        AppState.getInstance().setActiveTab('CLASES');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        AppState.getInstance().setActiveTab('ENTREGAS_EXAMENES');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        AppState.getInstance().setActiveTab('TODO');
        return;
      }

      const isPrev = e.key === 'ArrowLeft' || e.key === '<' || e.key === ',';
      const isNext = e.key === 'ArrowRight' || e.key === '>' || e.key === '.';

      if (!isPrev && !isNext) return;

      const now = Date.now();
      if (now - this.lastNavTime < 350) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.lastNavTime = now;

      if (isPrev) {
        const prevBtn = document.querySelector<HTMLButtonElement>(
          'header button[jsname="VfNHU"], header button[aria-label*="anterior" i]'
        );
        prevBtn?.click();
      } else if (isNext) {
        const nextBtn = document.querySelector<HTMLButtonElement>(
          'header button[jsname="OCpkoe"], header button[aria-label*="siguiente" i]'
        );
        nextBtn?.click();
      }
    };

    window.addEventListener('keydown', handleKeyNavigation, true);

    const prevRemover = this.removeEventListeners;
    this.removeEventListeners = () => {
      if (prevRemover) prevRemover();
      window.removeEventListener('keydown', handleKeyNavigation, true);
    };
  }

  private setupObservation(): void {
    if (this.observer) return;

    const startObserving = () => {
      if (!document.body || this.observer) return;
      let debounceTimer: any = null;
      this.observer = new MutationObserver(() => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          this.mountInTopHeader();
          this.injectSettingsMenuItemIfMenuOpen();
        }, 120);
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) {
      startObserving();
    } else {
      document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }
  }

  /**
   * Listens for clicks on Google Calendar's native Settings gear button
   * to immediately inject "🎓 Ajustes de Curso" into the dropdown menu as it renders.
   */
  private setupSettingsMenuInterception(): void {
    const handleGearClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const isGear = Boolean(
        target.closest(
          'header button[aria-label*="Configuración" i], header button[aria-label*="Settings" i], header [role="button"][aria-label*="Configuración" i], header [role="button"][aria-label*="Settings" i], button[jsname="j6uSdc"]'
        )
      );

      if (isGear) {
        // Retry dynamically while Google Calendar asynchronously animates the popup menu into the DOM
        for (const delay of [30, 80, 160, 300, 500]) {
          setTimeout(() => this.injectSettingsMenuItemIfMenuOpen(), delay);
        }
      }
    };

    window.addEventListener('click', handleGearClick, true);

    const prevRemover = this.removeEventListeners;
    this.removeEventListeners = () => {
      if (prevRemover) prevRemover();
      window.removeEventListener('click', handleGearClick, true);
    };
  }

  /**
   * Injects "🎓 Ajustes de Curso" directly inside Google Calendar's native
   * settings gear popup menu alongside "Configuración", "Papelera", etc.
   */
  public injectSettingsMenuItemIfMenuOpen(): boolean {
    if (typeof document === 'undefined') return false;

    const existingCustomItem = document.getElementById('gcal-academic-settings-menuitem');
    if (existingCustomItem && document.body.contains(existingCustomItem)) {
      return true;
    }

    // Google Calendar menus use [role="menu"] or class .JPdR6b, .goog-menu, .MocG8c
    const menus = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"], .JPdR6b, .goog-menu'));
    for (const menu of menus) {
      if (menu.style.display === 'none' || (menu.offsetWidth === 0 && menu.offsetHeight === 0)) continue;

      const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], .goog-menuitem, .JAPqpe'));
      if (items.length === 0) continue;

      // Identify if this is the Settings gear dropdown menu by looking for native items
      const isSettingsMenu = items.some((item) => {
        const txt = (item.textContent || '').toLowerCase();
        return (
          txt.includes('configuraci') ||
          txt.includes('setting') ||
          txt.includes('papelera') ||
          txt.includes('trash') ||
          txt.includes('densidad') ||
          txt.includes('density') ||
          txt.includes('imprimir') ||
          txt.includes('print')
        );
      });

      if (!isSettingsMenu) continue;

      // Find the "Configuración" / "Settings" menuitem to place right after it
      const configItem =
        items.find((item) => {
          const txt = (item.textContent || '').toLowerCase();
          return txt.includes('configuraci') || txt.includes('setting');
        }) || items[0];

      if (!configItem) continue;

      // Clone target item to replicate exact native Google styles, fonts, and layout
      const customItem = configItem.cloneNode(true) as HTMLElement;
      customItem.id = 'gcal-academic-settings-menuitem';
      customItem.setAttribute('role', 'menuitem');
      customItem.setAttribute('aria-label', t('course_settings'));
      customItem.setAttribute('tabindex', '-1');

      // Strip all native Google actions/delegation attributes to prevent triggering Google Settings
      const stripActionAttributes = (el: HTMLElement) => {
        el.removeAttribute('jsaction');
        el.removeAttribute('jsname');
        el.removeAttribute('data-action');
        el.removeAttribute('data-value');
        el.removeAttribute('data-href');
        el.removeAttribute('href');
      };
      stripActionAttributes(customItem);
      customItem.querySelectorAll<HTMLElement>('*').forEach(stripActionAttributes);

      // Update text in text node while preserving internal icon structure
      let textReplaced = false;
      const nodeFilter = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
      try {
        const walk = document.createTreeWalker(customItem, nodeFilter);
        let n: Node | null;
        while ((n = walk.nextNode())) {
          if (n.nodeValue && n.nodeValue.trim().length > 0) {
            if (!textReplaced) {
              n.nodeValue = t('course_settings');
              textReplaced = true;
            } else {
              n.nodeValue = '';
            }
          }
        }
      } catch (_) {}

      if (!textReplaced) {
        customItem.textContent = t('course_settings');
      }

      // Add right-aligned subtle shortcut hint (Ctrl+,)
      const shortcutBadge = document.createElement('span');
      shortcutBadge.className = 'gcal-menu-shortcut-badge';
      shortcutBadge.textContent = 'Ctrl+,';
      shortcutBadge.style.cssText = `
        margin-left: auto;
        padding-left: 16px;
        font-size: 11px;
        font-weight: 500;
        opacity: 0.6;
        letter-spacing: 0.5px;
        user-select: none;
      `;
      customItem.style.display = 'flex';
      customItem.style.alignItems = 'center';
      customItem.style.cursor = 'pointer';
      customItem.appendChild(shortcutBadge);

      // Intercept and halt ALL pointer/mouse events in the capture phase so Google never sees them
      const handleAction = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.type === 'click') {
          // Cleanly dismiss the native popup menu
          const menuParent = customItem.closest<HTMLElement>('[role="menu"], .JPdR6b, .goog-menu') || menu;
          if (menuParent) {
            menuParent.style.display = 'none';
          }
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));

          // Open Cursa settings in edit mode
          OnboardingModal.getInstance().open(true);
        }
      };

      ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((evtType) => {
        customItem.addEventListener(evtType, handleAction, true);
      });

      // Insert immediately following "Configuración"
      if (configItem.nextSibling) {
        configItem.parentNode?.insertBefore(customItem, configItem.nextSibling);
      } else {
        configItem.parentNode?.appendChild(customItem);
      }

      return true;
    }

    return false;
  }

  public destroy(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.removeEventListeners) {
      this.removeEventListeners();
      this.removeEventListeners = null;
    }
    if (this.headerTabsContainer && this.headerTabsContainer.parentNode) {
      this.headerTabsContainer.parentNode.removeChild(this.headerTabsContainer);
      this.headerTabsContainer = null;
    }
    const legacyBtn = document.getElementById('gcal-academic-settings-btn');
    if (legacyBtn && legacyBtn.parentNode) {
      legacyBtn.parentNode.removeChild(legacyBtn);
    }
    const customMenuItem = document.getElementById('gcal-academic-settings-menuitem');
    if (customMenuItem && customMenuItem.parentNode) {
      customMenuItem.parentNode.removeChild(customMenuItem);
    }
    AcademicPanel.instance = null;
  }
}
