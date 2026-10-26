import { AcademicEventPayload, AppTab, EventType } from '../../shared/types';
import { formatAcademicEventUrl } from '../../shared/formatters';
import { safeSetInnerHTML, escapeHtml } from '../utils/dom';
import { getIsolatedItem, setIsolatedItem, removeIsolatedItem } from '../utils/storage';
import { AppState } from '../state';

export class GoogleCalendarAdapter {
  private static instance: GoogleCalendarAdapter | null = null;
  private observer: MutationObserver | null = null;
  private currentActiveTab: AppTab = 'CLASES';

  private isSyncing: boolean = false;
  private initialSyncDone: boolean = false;
  private chipPollInterval: any = null;
  private deletedEventIds: Set<string> = new Set();
  private selectionListener: (() => void) | null = null;

  public static getInstance(): GoogleCalendarAdapter {
    if (!GoogleCalendarAdapter.instance) {
      GoogleCalendarAdapter.instance = new GoogleCalendarAdapter();
    }
    return GoogleCalendarAdapter.instance;
  }

  private constructor() {}

  public init(): void {
    // Self-healing migration for v1.0.4:
    // Reset legacy show_other_calendars=false to true and purge stale mock subjects
    try {
      if (getIsolatedItem('gcal_v104_migrated') !== 'true') {
        setIsolatedItem('gcal_show_other_calendars', 'true');
        const stored = getIsolatedItem('gcal_academic_subjects');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (
              Array.isArray(parsed) &&
              parsed.length <= 4 &&
              parsed.every((s: any) => ['Matemáticas', 'Física', 'Programación', 'Economía'].includes(typeof s === 'string' ? s : s.name))
            ) {
              removeIsolatedItem('gcal_academic_subjects');
            }
          } catch (_) {}
        }
        setIsolatedItem('gcal_v104_migrated', 'true');
      }
    } catch (_) {}

    try {
      const storedDeleted = getIsolatedItem('gcal_deleted_events');
      if (storedDeleted) {
        const parsed = JSON.parse(storedDeleted);
        if (Array.isArray(parsed)) {
          this.deletedEventIds = new Set(parsed);
          this.applyDeletedEventsCss();
        }
      }
    } catch (_) {}

    this.currentActiveTab = AppState.getInstance().getState().activeTab;
    this.injectCleanLayoutStyles();
    this.setupSelectionGuard();
    this.tagCalendarRows();
    this.setupObserver();
    this.applyTabFilter(this.currentActiveTab, true);
    this.enhanceAcademicChips();
    this.consumePendingToast();
    if (!this.chipPollInterval && typeof window !== 'undefined') {
      this.chipPollInterval = setInterval(() => {
        this.enhanceAcademicChips();
      }, 3000);
    }
  }

  private consumePendingToast(): void {
    try {
      if (typeof sessionStorage === 'undefined' || typeof document === 'undefined') return;
      const msg = sessionStorage.getItem('gcal_pending_toast');
      if (!msg) return;
      sessionStorage.removeItem('gcal_pending_toast');

      setTimeout(() => {
        const existing = document.querySelector('#gcal-toast-msg');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'gcal-toast-msg';
        toast.style.cssText = `
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          background: #1e293b;
          color: #ffffff;
          padding: 12px 24px;
          border-radius: 28px;
          font-size: 13.5px;
          font-weight: 600;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          z-index: 9999999;
          opacity: 1;
          transition: opacity 0.3s ease;
          pointer-events: none;
          font-family: 'Google Sans', Roboto, sans-serif;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = '0';
          setTimeout(() => toast.remove(), 300);
        }, 3200);
      }, 450);
    } catch (_) {}
  }

  /**
   * Cleans up unwanted distracting elements per design specifications (CAP3):
   * - Birthday calendar ("Cumpleaños")
   * - Help button ("?") in top header
   * - Google Apps launcher (":::") in top header
   * - "Buscar a gente" search block in sidebar
   * - "Páginas de reserva" section in sidebar
   * - "Otros calendarios" section in sidebar
   * - "Términos – Privacidad" footer links
   * Ensures clean native layout without gaps or misalignment.
   */
  public shouldHideBirthdays(): boolean {
    try {
      const val = getIsolatedItem('gcal_hide_birthdays');
      return val !== 'false';
    } catch {
      return true;
    }
  }

  public shouldShowOtherCalendars(): boolean {
    try {
      const val = getIsolatedItem('gcal_show_other_calendars');
      return val !== 'false';
    } catch {
      return true;
    }
  }

  public injectCleanLayoutStyles(): void {
    const styleId = 'gcal-custom-clean-layout';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }

    const hideBirthdays = this.shouldHideBirthdays();
    const showOther = this.shouldShowOtherCalendars();

    style.textContent = `
        /* 1. Removal of Cumpleaños (when enabled, default: true) */
        ${hideBirthdays ? `
        [data-property*="birthday" i],
        [data-property*="cumpleaño" i],
        [aria-label*="Cumpleaños" i],
        [aria-label*="Birthdays" i],
        li:has([aria-label*="Cumpleaños" i]),
        li:has([aria-label*="Birthdays" i]),
        .XXcuqd:has([aria-label*="Cumpleaños" i]),
        .XXcuqd:has([aria-label*="Birthdays" i]),
        ` : ''}

        /* 2. Top Header: Help button (?) */
        [jsname="bMWlzf"],
        .h8Aqhb:has([aria-label*="Ayuda" i]),
        .h8Aqhb:has([aria-label*="Help" i]),
        button[aria-label*="Ayuda" i],
        button[aria-label*="Help" i],
        .bMWlzf:has([aria-label="Ayuda"]),
        .bMWlzf:has([aria-label="Help"]),
        .bMWlzf[data-tooltip="Ayuda"],
        .bMWlzf[data-tooltip="Help"],
        #M842Cd,

        /* 3. Top Header: Google Apps launcher (:::) */
        #gbwa,
        .gb_sd:has(#gbwa),
        .gb_sd:has([aria-label*="Google apps" i]),
        .gb_sd:has([aria-label*="Aplicaciones de Google" i]),

        /* 4. Sidebar: "Buscar a gente" search block */
        .qXIcZc.ZtL5hd,
        .qXIcZc:has([aria-label*="Buscar a gente" i]),
        .qXIcZc:has([aria-label*="Search for people" i]),

        /* 5. Sidebar: "Páginas de reserva" section */
        .qOsM1d.f477s,
        .qOsM1d:has([aria-label*="Páginas de reserva" i]),
        .qOsM1d:has(.az313e),

        /* 6. Sidebar: "Otros calendarios" section (hidden by default unless enabled in settings) */
        ${!showOther ? `
        .qZvm2d-clz4Ic,
        .GSVYRe:has([aria-label*="Otros calendarios" i]),
        .GSVYRe:has(.aIwHYe),
        #tkQpTb,
        [jsname="tkQpTb"],
        ` : ''}

        /* 7. Sidebar footer: "Términos – Privacidad" */
        .erDb5d,
        .erDb5d:has(a[href*="terms"]),
        .erDb5d:has(a[href*="privacy"]) {
          display: none !important;
        }

        /* 8. Static natural flow with smooth fluid collapse/expand */
        .XXcuqd {
          position: relative !important;
          top: auto !important;
          left: auto !important;
          transform: none !important;
          box-sizing: border-box !important;
          max-height: 48px !important;
          opacity: 1 !important;
          overflow: hidden !important;
          transition: opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      max-height 0.24s cubic-bezier(0.4, 0, 0.2, 1),
                      margin 0.24s cubic-bezier(0.4, 0, 0.2, 1),
                      padding 0.24s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        div:has(> .XXcuqd) {
          height: auto !important;
          transition: none !important;
        }

        /* 9. Fluid tab filtering */
        ${hideBirthdays ? `
        .XXcuqd[data-gcal-type="birthday"] {
          display: none !important;
        }
        ` : ''}

        /* Filtered out items smoothly collapse to 0 height and fade out */
        body[data-gcal-tab="CLASES"] .XXcuqd[data-gcal-type="academic"],
        body[data-gcal-tab="CLASES"] .XXcuqd[data-gcal-type="other"],
        body[data-gcal-tab="ENTREGAS_EXAMENES"] .XXcuqd[data-gcal-type="class"],
        body[data-gcal-tab="ENTREGAS_EXAMENES"] .XXcuqd[data-gcal-type="other"] {
          max-height: 0 !important;
          opacity: 0 !important;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
          transition: opacity 0.18s cubic-bezier(0.4, 0, 0.2, 1),
                      max-height 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      margin 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      padding 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      visibility 0.22s !important;
        }

        body[data-gcal-tab="TODO"] .XXcuqd${hideBirthdays ? ':not([data-gcal-type="birthday"])' : ''} {
          max-height: 48px !important;
          opacity: 1 !important;
          visibility: visible !important;
          pointer-events: auto !important;
        }

        /* 10. Academic Event Chips: Option 1 Badge Pro Styling */
        .custom-academic-container {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          pointer-events: auto !important;
          cursor: pointer !important;
          border-radius: inherit !important;
          overflow: hidden !important;
          box-sizing: border-box !important;
          z-index: 2 !important;
        }

        [data-gcal-enhanced] .Jcb6qd,
        [data-gcal-enhanced] .XuJrye,
        [data-eventchip]:has(.custom-academic-container) .Jcb6qd,
        [data-eventchip]:has(.custom-academic-container) .XuJrye {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }

        /* 11. Entregas en modo oculto / realizadas (baja opacidad pero visibles) */
        [data-eventchip].gcal-chip-dimmed,
        .custom-academic-container.gcal-chip-dimmed {
          opacity: 0.25 !important;
          filter: grayscale(0.55) !important;
          transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), filter 0.25s ease !important;
        }

        /* 12. Eventos académicos de otros cuatrimestres / periodos inactivos */
        [data-eventchip][data-gcal-inactive-term="true"] {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        [data-eventchip].gcal-chip-dimmed:hover,
        .custom-academic-container.gcal-chip-dimmed:hover {
          opacity: 0.82 !important;
          filter: grayscale(0.05) !important;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
        }

        /* 13. Prevent accidental blue text/column selection & focus outline on calendar grid */
        [role="main"],
        [role="main"] *:not(input):not(textarea):not([contenteditable="true"]):not([role="textbox"]):not([role="dialog"] *),
        [role="grid"],
        [role="columnheader"],
        [role="gridcell"],
        [role="row"],
        .T5D48c,
        .SGWAac,
        .Yvjgnd,
        .mVkCId,
        [data-eventchip] {
          -webkit-user-select: none !important;
          user-select: none !important;
        }

        /* Suppress native browser blue text selection highlight across calendar grid */
        [role="main"] ::selection {
          background: transparent !important;
        }

        /* Remove blue focus outlines from calendar columns, cells, and grid headers */
        [role="gridcell"]:focus,
        [role="gridcell"]:focus-visible,
        [role="columnheader"]:focus,
        [role="columnheader"]:focus-visible,
        [role="grid"]:focus,
        [role="grid"]:focus-visible,
        .Yvjgnd:focus,
        .mVkCId:focus {
          outline: none !important;
          box-shadow: none !important;
        }

        /* Ensure all text inputs, textareas, and modal fields remain selectable and editable */
        input,
        textarea,
        [contenteditable="true"],
        [role="textbox"],
        [role="dialog"],
        [role="dialog"] * {
          -webkit-user-select: text !important;
          user-select: text !important;
        }

        input::selection,
        textarea::selection,
        [contenteditable="true"]::selection,
        [role="textbox"]::selection,
        [role="dialog"] ::selection {
          background: #b3d7ff !important;
          color: inherit !important;
        }
      `;
  }

  private normalizeSubjectText(text: string): string {
    return (text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s@.]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  public getConfiguredSubjects(): string[] {
    try {
      const stored = getIsolatedItem('gcal_academic_subjects');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const names = parsed
            .map((p: any) => (typeof p === 'string' ? p.trim() : (p?.name || '').trim()))
            .filter(Boolean);
          if (names.length > 0) {
            return Array.from(new Set(names));
          }
        }
      }
    } catch (_) {}
    return [];
  }

  public getActiveProfileIdentifiers(): string[] {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
      return [];
    }
    const identifiers = new Set<string>();
    try {
      const accountEl = document.querySelector<HTMLElement>(
        'header a[href*="SignOutOptions"], [data-email], a[aria-label*="@"], div[aria-label*="@"]'
      );
      if (accountEl) {
        const emailAttr = (accountEl.getAttribute('data-email') || '').trim().toLowerCase();
        if (emailAttr && emailAttr.includes('@')) {
          identifiers.add(emailAttr);
          identifiers.add(emailAttr.split('@')[0]);
        }

        const ariaLabel = accountEl.getAttribute('aria-label') || '';
        const emailMatch = ariaLabel.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          const email = emailMatch[1].toLowerCase();
          identifiers.add(email);
          identifiers.add(email.split('@')[0]);
        }

        // Extract display name from "Cuenta de Google: Nombre Apellido (email@...)" or "Google Account: Name (email@...)"
        const nameMatch = ariaLabel.match(/(?:Cuenta de Google|Google Account|Compte Google|Google-Konto)\s*:\s*([^(,\n]+?)(?:\s*\(|$)/i);
        if (nameMatch && nameMatch[1]) {
          const normName = this.normalizeSubjectText(nameMatch[1]);
          if (normName.length >= 2) {
            identifiers.add(normName);
          }
        }
      }
    } catch (_) {}
    return Array.from(identifiers);
  }

  public isAcademic(name: string): boolean {
    return /ex[aá]men|exam|entrega|entegra|control|parcial|quiz|deadline|assignment|due|klausur|pr[üu]fung|devoir|assignement/i.test(name);
  }

  public isPersonal(name: string): boolean {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    if (/personal|mi calendario|my calendar|default calendar/i.test(trimmed)) {
      return true;
    }
    // Primary calendars named directly with an email address
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
      return true;
    }
    const norm = this.normalizeSubjectText(trimmed);
    if (!norm) return false;
    const profileIds = this.getActiveProfileIdentifiers();
    return profileIds.some((id) => norm === id || trimmed.toLowerCase() === id);
  }

  public isOther(name: string): boolean {
    return /task|tarea|festivo|holiday|feiertag|vacance|vacaci|ferie|recordatorio|reminder/i.test(name) || this.isPersonal(name);
  }

  public isBirthday(name: string): boolean {
    return /cumpleaño|birthday|anniversaire|geburtstag|aniversari/i.test(name);
  }

  private matchesConfiguredSubject(name: string, configured: string[]): boolean {
    if (configured.length === 0) return false;
    const normCandidate = this.normalizeSubjectText(name);
    if (!normCandidate) return false;

    return configured.some((subj) => {
      const normSubj = this.normalizeSubjectText(subj);
      if (!normSubj) return false;
      return (
        normCandidate === normSubj ||
        normCandidate.startsWith(normSubj + ' ') ||
        normCandidate.endsWith(' ' + normSubj)
      );
    });
  }

  private hasExplicitTermSubjects(): boolean {
    try {
      return getIsolatedItem('gcal_academic_subjects') !== null;
    } catch {
      return false;
    }
  }

  private isArchivedInOtherTerm(name: string, activeConfigured: string[]): boolean {
    if (this.matchesConfiguredSubject(name, activeConfigured)) return false;
    try {
      const rawArchive = getIsolatedItem('gcal_terms_archive');
      if (!rawArchive) return false;
      const archive = JSON.parse(rawArchive);
      if (!archive || typeof archive !== 'object') return false;
      for (const snap of Object.values(archive) as any[]) {
        if (snap && Array.isArray(snap.subjects)) {
          const archivedNames = snap.subjects
            .map((s: any) => (typeof s === 'string' ? s : s?.name || ''))
            .filter(Boolean);
          if (this.matchesConfiguredSubject(name, archivedNames)) {
            return true;
          }
        }
      }
    } catch (_) {}
    return false;
  }

  public isClass(name: string): boolean {
    if (!name || !name.trim()) return false;
    if (this.isAcademic(name) || this.isBirthday(name)) {
      return false;
    }
    const configured = this.getConfiguredSubjects();
    if (this.matchesConfiguredSubject(name, configured)) {
      return true;
    }
    if (this.hasExplicitTermSubjects()) {
      // If active term is explicitly empty or this subject belongs to another archived term, hide it
      if (configured.length === 0 || this.isArchivedInOtherTerm(name, configured)) {
        return false;
      }
    }
    if (this.isOther(name) || this.isPersonal(name)) {
      return false;
    }
    return true;
  }

  /**
   * Returns detected subjects / classes for the active period.
   * When the user has configured subjects for the active period (including [] for a new empty period),
   * strictly returns those subjects so previous periods' subjects disappear cleanly.
   */
  public getDetectedClasses(): string[] {
    const configured = this.getConfiguredSubjects();
    if (this.hasExplicitTermSubjects()) {
      return configured;
    }

    let domClasses: string[] = [];

    // Scan active DOM checkboxes if available (only before onboarding/plan is configured)
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const checkboxes = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], [role="checkbox"]')
      );
      domClasses = checkboxes
        .map((cb) => {
          const row = cb.closest<HTMLElement>('.XXcuqd') || cb.closest<HTMLElement>('li, .DYTqTd, [role="listitem"]');
          const rawName = cb.getAttribute('aria-label') || row?.textContent?.trim() || '';
          return rawName
            .replace(/\bmore_vert.*$/i, '')
            .trim();
        })
        .filter((name) => Boolean(name) && this.isClass(name));
    }

    if (domClasses.length > 0) {
      const merged: string[] = [];
      const seenNormalized = new Set<string>();
      for (const item of domClasses) {
        const key = this.normalizeSubjectText(item) || item.toLowerCase().trim();
        if (!seenNormalized.has(key)) {
          seenNormalized.add(key);
          merged.push(item);
        }
      }
      if (merged.length > 0) {
        return merged;
      }
    }

    return [
      'Matemáticas',
      'Física',
      'Programación',
      'Economía'
    ];
  }

  /**
   * Tags native Google Calendar rows with data-gcal-type attribute for instant pure CSS filtering.
   */
  public tagCalendarRows(): void {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const checkboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], [role="checkbox"]')
    );

    checkboxes.forEach((cb) => {
      const row = cb.closest<HTMLElement>('.XXcuqd') || cb.closest<HTMLElement>('li, .DYTqTd, [role="listitem"]');
      if (!row) return;

      const rawName = cb.getAttribute('aria-label') || row.textContent?.trim() || '';
      if (!rawName) return;

      let type = 'other';
      if (this.isBirthday(rawName)) {
        type = 'birthday';
      } else if (this.isClass(rawName)) {
        type = 'class';
      } else if (this.isAcademic(rawName)) {
        type = 'academic';
      }

      row.setAttribute('data-gcal-type', type);
    });
  }

  /**
   * Filters the visible Google Calendar checkboxes according to active tab:
   * - CLASES: exclusively the 6 class calendars are shown & checked.
   * - ENTREGAS Y EXÁMENES: exclusively Exámenes and Entregas are shown & checked.
   * - TODO: all allowed calendars are shown & checked. Never Cumpleaños.
   * Switches rows instantaneously (0ms) using CSS selectors on body[data-gcal-tab].
   * If syncSelection is true (user switched tabs), synchronizes checkbox checked states
   * so only the active tab's calendars are rendered on the grid.
   */
  public applyTabFilter(tab: AppTab, syncSelection: boolean = false): void {
    this.currentActiveTab = tab;

    // Instant compositor-level CSS filtering (0ms latency, zero lag)
    if (document.body && typeof document.body.setAttribute === 'function') {
      document.body.setAttribute('data-gcal-tab', tab);
    }

    this.tagCalendarRows();
    this.enhanceAcademicChips();

    // Synchronize native checkbox checked status so events on the calendar grid reflect the active tab
    if (syncSelection && !this.isSyncing) {
      this.isSyncing = true;
      try {
        const checkboxes = Array.from(
          document.querySelectorAll<HTMLElement>('input[type="checkbox"], [role="checkbox"]')
        );
        if (checkboxes.length > 0) {
          this.initialSyncDone = true;
        }

        const hasAcademicCalendars = checkboxes.some((cb) => {
          const row = cb.closest<HTMLElement>('.XXcuqd') || cb.closest<HTMLElement>('li, .DYTqTd, [role="listitem"]');
          const rawName = cb.getAttribute('aria-label') || row?.textContent?.trim() || '';
          return this.isAcademic(rawName);
        });

        checkboxes.forEach((cb) => {
          const row = cb.closest<HTMLElement>('.XXcuqd') || cb.closest<HTMLElement>('li, .DYTqTd, [role="listitem"]');
          if (!row) return;

          const rawName = cb.getAttribute('aria-label') || row.textContent?.trim() || '';
          if (!rawName) return;

          const isChecked = cb instanceof HTMLInputElement ? cb.checked : cb.getAttribute('aria-checked') === 'true';

          if (this.isBirthday(rawName)) {
            if (isChecked && this.shouldHideBirthdays()) {
              cb.click();
            }
            return;
          }

          let shouldCheck = true;
          if (tab === 'CLASES') {
            shouldCheck = this.isClass(rawName);
          } else if (tab === 'ENTREGAS_EXAMENES') {
            const allowPrimaryFallback = getIsolatedItem('gcal_allow_primary_in_academic') === 'true';
            shouldCheck = hasAcademicCalendars
              ? this.isAcademic(rawName) || (allowPrimaryFallback && this.isPersonal(rawName))
              : true;
          } else {
            shouldCheck = true;
          }

          if (shouldCheck && !isChecked) {
            cb.click();
          } else if (!shouldCheck && isChecked) {
            cb.click();
          }
          try {
            AppState.getInstance().setCalendarVisibility(rawName, shouldCheck);
          } catch (_) {}
        });
      } finally {
        this.isSyncing = false;
        setTimeout(() => this.enhanceAcademicChips(), 200);
      }
    }
  }

  /**
   * Creates an academic event (Examen or Entrega) in Google Calendar.
   */
  public async createAcademicEvent(payload: AcademicEventPayload): Promise<boolean> {
    const desktopApi = (typeof window !== 'undefined' ? (window as any).gcalDesktopAPI : null);
    if (desktopApi && typeof desktopApi.createAcademicEventBackground === 'function') {
      const res = await desktopApi.createAcademicEventBackground(payload);
      if (res && res.success) {
        try {
          setIsolatedItem('gcal_allow_primary_in_academic', res.usedPrimaryFallback ? 'true' : 'false');
        } catch (_) {}

        // Clear any previous deletion filter matching this title
        if (payload.title) {
          const cleanTitle = payload.title.trim().toLowerCase();
          let removed = false;
          this.deletedEventIds.forEach((id) => {
            if (id.toLowerCase().includes(cleanTitle)) {
              this.deletedEventIds.delete(id);
              removed = true;
            }
          });
          if (removed) {
            try {
              setIsolatedItem('gcal_deleted_events', JSON.stringify(Array.from(this.deletedEventIds)));
            } catch (_) {}
            this.applyDeletedEventsCss();
          }
        }

        // Guarantee user stays on ENTREGAS_EXAMENES with correct calendars filtered
        this.applyTabFilter('ENTREGAS_EXAMENES', true);

        // Soft refresh grid to show newly created event
        setTimeout(() => {
          this.triggerGridRefresh();
        }, 500);

        return true;
      }
      return false;
    }

    const targetUrl = formatAcademicEventUrl(payload);
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = targetUrl;
    }
    return true;
  }

  /**
   * Moves / reschedules an existing academic event to a new date and time.
   */
  public async moveAcademicEvent(oldEventId: string | undefined, newPayload: AcademicEventPayload): Promise<boolean> {
    const desktopApi = (typeof window !== 'undefined' ? (window as any).gcalDesktopAPI : null);
    if (desktopApi && typeof desktopApi.moveAcademicEventBackground === 'function') {
      const res = await desktopApi.moveAcademicEventBackground({ eventId: oldEventId, payload: newPayload });
      if (res && res.success) {
        this.applyTabFilter('ENTREGAS_EXAMENES', true);
        setTimeout(() => {
          this.triggerGridRefresh();
        }, 500);
        return true;
      }
    }

    return this.createAcademicEvent(newPayload);
  }

  /**
   * Permanently marks an event as deleted, adds real-time CSS suppression rules,
   * purges all matching DOM chips with a smooth animation, and updates persistent storage.
   */
  public markEventDeleted(eventId: string, title?: string, _subject?: string): void {
    if (!eventId) return;
    const cleanId = eventId.split(' ')[0].trim();
    if (cleanId) this.deletedEventIds.add(cleanId);
    this.deletedEventIds.add(eventId.trim());

    try {
      setIsolatedItem('gcal_deleted_events', JSON.stringify(Array.from(this.deletedEventIds)));
    } catch (_) {}

    this.applyDeletedEventsCss();

    // Immediately purge from DOM without waiting for next mutation tick
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const targets = document.querySelectorAll<HTMLElement>('[data-eventchip], [data-eventid]');
      targets.forEach((el) => {
        const id = el.getAttribute('data-eventid') || '';
        const txt = (el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '');
        if (
          (cleanId && (id.includes(cleanId) || txt.includes(cleanId))) ||
          (title && title.length >= 3 && txt.includes(title.trim()))
        ) {
          const container = el.closest<HTMLElement>('[data-eventchip]') || el;
          container.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          container.style.opacity = '0';
          container.style.transform = 'scale(0.92)';
          container.style.pointerEvents = 'none';
          setTimeout(() => container.remove(), 200);
        }
      });
    }
  }

  /**
   * Applies CSS rules hiding all deleted event chips. Even if Google Calendar
   * tries to re-render them from client memory cache, the compositor keeps them invisible.
   */
  public applyDeletedEventsCss(): void {
    if (typeof document === 'undefined') return;
    const styleId = 'gcal-deleted-events-style';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }

    if (this.deletedEventIds.size === 0) {
      style.textContent = '';
      return;
    }

    const selectors: string[] = [];
    this.deletedEventIds.forEach((id) => {
      const safeId = id.replace(/["\\]/g, '');
      if (safeId.length >= 2) {
        selectors.push(`[data-eventid*="${safeId}"]`);
        selectors.push(`[data-eventchip]:has([data-eventid*="${safeId}"])`);
      }
    });

    if (selectors.length > 0) {
      style.textContent = `
        ${selectors.join(',\n')} {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          height: 0 !important;
          max-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          opacity: 0 !important;
        }
      `;
    }
  }

  /**
   * Refreshes the calendar grid by purging deleted events and re-applying chip enhancements.
   * Avoids destructive week flipping which causes stale memory cache revival.
   */
  public triggerGridRefresh(): void {
    try {
      this.applyDeletedEventsCss();
      this.enhanceAcademicChips();
    } catch (_) {}
  }

  /**
   * Navigates or reloads the main Google Calendar window onto the target ISO date (YYYY-MM-DD)
   * so events created/moved in the background BrowserWindow are fetched fresh from Google's servers
   * and immediately visible on the calendar grid.
   */
  public navigateToEventDate(isoDate?: string, pendingToastMsg?: string): void {
    try {
      if (pendingToastMsg && typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('gcal_pending_toast', pendingToastMsg);
      }
      if (typeof window === 'undefined' || !window.location) {
        return;
      }

      const currentHref = window.location.href || '';
      if (!currentHref.startsWith('http')) {
        return;
      }

      if (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        const [yr, mo, dy] = isoDate.split('-').map(Number);
        const uMatch = currentHref.match(/\/calendar\/u\/(\d+)/);
        const uIdx = uMatch ? uMatch[1] : '0';
        const viewMatch = currentHref.match(/\/r\/(day|week|month|year|schedule|customday)\b/i);

        if (viewMatch) {
          const viewMode = viewMatch[1].toLowerCase();
          const targetUrl = `https://calendar.google.com/calendar/u/${uIdx}/r/${viewMode}/${yr}/${mo}/${dy}`;
          const normalizedCurrent = currentHref.split('?')[0].split('#')[0].replace(/\/$/, '');
          if (normalizedCurrent === targetUrl) {
            window.location.reload();
          } else {
            window.location.href = targetUrl;
          }
          return;
        }

        // Bare /r default view: reload in place if event is near today, otherwise jump to target week
        const now = new Date();
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const targetMidnight = new Date(yr, mo - 1, dy).getTime();
        const dayDiff = Math.abs(Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24)));

        if (dayDiff <= 2 && typeof window.location.reload === 'function') {
          window.location.reload();
        } else {
          window.location.href = `https://calendar.google.com/calendar/u/${uIdx}/r/week/${yr}/${mo}/${dy}`;
        }
        return;
      }

      if (typeof window.location.reload === 'function') {
        window.location.reload();
      }
    } catch (_) {}
  }

  private setupObserver(): void {
    if (this.observer) return;

    let debounceTimer: any = null;
    this.observer = new MutationObserver(() => {
      if (this.isSyncing) return;
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        this.tagCalendarRows();
        this.enhanceAcademicChips();
        if (!this.initialSyncDone) {
          const checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
          if (checkboxes.length > 0) {
            this.applyTabFilter(this.currentActiveTab, true);
          }
        }
      }, 80);
    });

    if (document.body) {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  /**
   * Retrieves the dynamic color map from class calendars in the sidebar.
   */
  public static readonly DEFAULT_SUBJECT_COLORS: Record<string, string> = {
    'clase 1': '#B69A31',
    'clase 2': '#90B0C4',
    'clase 3': '#96BCBB',
    'clase 4': '#C2842D',
    'clase 5': '#BAB35A',
    'clase 6': '#6B8D8A',
    'clase 7': '#5C6BC0',
    'clase 8': '#8E24AA',
    'clase 9': '#E53935',
    'clase 10': '#FB8C00',
    'asignatura 1': '#B69A31',
    'asignatura 2': '#90B0C4',
    'asignatura 3': '#96BCBB',
    'asignatura 4': '#C2842D',
    'asignatura 5': '#BAB35A',
    'asignatura 6': '#6B8D8A',
    'asignatura 7': '#5C6BC0',
    'asignatura 8': '#8E24AA',
    'asignatura 9': '#E53935',
    'asignatura 10': '#FB8C00',
    'matematicas': '#BAB35A',
    'fisica': '#A1D0CA',
    'programacion': '#90B0C4',
    'economia': '#96BCBB'
  };

  public normalizeStr(str: string): string {
    return str
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  public getDeterministicSubjectColor(name: string): string {
    const PALETTE = [
      '#90B0C4', // Steel Blue
      '#B69A31', // Gold
      '#96BCBB', // Teal
      '#C2842D', // Bronze
      '#BAB35A', // Olive
      '#6B8D8A', // Deep Teal
      '#5C6BC0', // Indigo
      '#E53935', // Crimson
      '#8E24AA', // Purple
      '#FB8C00'  // Amber
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % PALETTE.length;
    return PALETTE[idx];
  }

  /**
   * Retrieves the dynamic color map from class calendars in the sidebar,
   * seeded by known subject colors and persisted in localStorage so it never fails.
   */
  public getSubjectColorMap(): Map<string, string> {
    const colorMap = new Map<string, string>();

    // 1. Seed with known default subject colors
    for (const [key, color] of Object.entries(GoogleCalendarAdapter.DEFAULT_SUBJECT_COLORS)) {
      colorMap.set(key, color);
    }

    // 2. Load any previously saved dynamic colors from isolated storage
    try {
      const cached = JSON.parse(getIsolatedItem('gcal_subject_colors') || '{}');
      for (const [key, color] of Object.entries(cached)) {
        if (typeof color === 'string' && color) {
          colorMap.set(key.toLowerCase(), color);
          colorMap.set(this.normalizeStr(key), color);
        }
      }
      const storedSubjects = getIsolatedItem('gcal_academic_subjects');
      if (storedSubjects) {
        const parsedSubs = JSON.parse(storedSubjects);
        if (Array.isArray(parsedSubs)) {
          parsedSubs.forEach((s: any) => {
            if (s && s.name && s.color) {
              colorMap.set(s.name.toLowerCase().trim(), s.color);
              colorMap.set(this.normalizeStr(s.name), s.color);
            }
          });
        }
      }
    } catch (_) {}

    // 3. Scan active checkboxes in the sidebar (if currently rendered in DOM)
    if (typeof document !== 'undefined') {
      let updatedFromDOM = false;
      const checkboxes = Array.from(
        document.querySelectorAll<HTMLElement>('input[type="checkbox"], [role="checkbox"]')
      );

      checkboxes.forEach((cb) => {
        const row = cb.closest<HTMLElement>('.XXcuqd') || cb.closest<HTMLElement>('li, .DYTqTd, [role="listitem"]');
        const rawName = (cb.getAttribute('aria-label') || row?.textContent?.trim() || '')
          .replace(/\bmore_vert.*$/i, '')
          .trim();
        if (!rawName || this.isAcademic(rawName) || this.isBirthday(rawName)) return;

        let color = '';
        const elWithVar = row?.querySelector<HTMLElement>('[style*="--checkbox-color"]');
        if (elWithVar) {
          const m = (elWithVar.getAttribute('style') || '').match(/--checkbox-color:\s*([^;]+)/);
          if (m) color = m[1].trim();
        }
        if (!color && row) {
          const filled = row.querySelector<HTMLElement>('.KGC9Kd-YQoJzd');
          if (filled) {
            const bg = window.getComputedStyle(filled).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)') color = bg;
          }
        }

        if (color) {
          colorMap.set(rawName.toLowerCase(), color);
          const cleanName = this.normalizeStr(rawName);
          if (cleanName) {
            colorMap.set(cleanName, color);
            updatedFromDOM = true;
          }
        }
      });

      if (updatedFromDOM) {
        try {
          const obj: Record<string, string> = {};
          for (const [k, v] of colorMap.entries()) {
            obj[k] = v;
          }
          setIsolatedItem('gcal_subject_colors', JSON.stringify(obj));
        } catch (_) {}
      }
    }

    return colorMap;
  }

  public findSubjectColor(subject: string, colorMap: Map<string, string>): string {
    const clean = this.normalizeStr(subject || '');
    if (clean) {
      if (colorMap.has(clean)) return colorMap.get(clean)!;

      const lower = subject.toLowerCase().trim();
      if (colorMap.has(lower)) return colorMap.get(lower)!;

      for (const [key, color] of colorMap.entries()) {
        if (clean.length >= 3 && (key.includes(clean) || clean.includes(key))) {
          return color;
        }
      }
    }

    return this.getDeterministicSubjectColor(clean || subject || 'general');
  }

  private parseColorToHsl(colorStr: string): [number, number, number] {
    let r = 0, g = 0, b = 0;
    if (colorStr.startsWith('#')) {
      let hex = colorStr.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      r = parseInt(hex.substring(0, 2), 16) / 255;
      g = parseInt(hex.substring(2, 4), 16) / 255;
      b = parseInt(hex.substring(4, 6), 16) / 255;
    } else if (colorStr.startsWith('rgb')) {
      const nums = colorStr.match(/\d+/g);
      if (nums && nums.length >= 3) {
        r = parseInt(nums[0], 10) / 255;
        g = parseInt(nums[1], 10) / 255;
        b = parseInt(nums[2], 10) / 255;
      }
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  private hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /**
   * Enhances academic event chips in the calendar grid with "Badge Pro" (Option 1):
   * 1 Tipo (Badge pill) -> 2 Asignatura -> 3 Título (grande) -> 4 Descripción/Ubicación -> 5 Horas
   */
  public enhanceAcademicChips(): void {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-eventchip]'));
    if (chips.length === 0) return;

    const colorMap = this.getSubjectColorMap();

    chips.forEach((chip) => {
      const rawAria = chip.getAttribute('aria-label') || '';
      const ariaHidden = chip.querySelector('.XuJrye')?.textContent || '';
      const allText = `${chip.innerText || ''} ${rawAria} ${ariaHidden}`;
      const chipEventId = (chip.getAttribute('data-eventid') || '').trim();

      // Check if event is marked as deleted; purge immediately and skip
      if (
        this.deletedEventIds.size > 0 &&
        Array.from(this.deletedEventIds).some(
          (delId) => (chipEventId && chipEventId.includes(delId)) || (delId.length >= 4 && allText.includes(delId))
        )
      ) {
        chip.style.display = 'none';
        chip.remove();
        return;
      }

      const isAcademic = /\[?(EXAMEN|ENTREGA)\]?|calendario:\s*[^,]*(exam|ent[er]gra)|entrega|entegra|ex[aá]men|exam|parcial|control|quiz|deadline|assignment|due|klausur|pr[üu]fung|devoir/i.test(allText);
      if (!isAcademic) {
        const existing = chip.querySelector('.custom-academic-container');
        if (existing) {
          existing.remove();
          chip.removeAttribute('data-gcal-enhanced');
          const stdContent = chip.querySelector<HTMLElement>('.Jcb6qd');
          if (stdContent) {
            stdContent.style.visibility = '';
            stdContent.style.opacity = '';
          }
        }
        return;
      }

      // Extract raw title from native title span (Week/Day: .I0UMhf, Month/Compact: .WBi6vc / .FAxxKc)
      const titleSpan = chip.querySelector('.I0UMhf, .WBi6vc, .FAxxKc');
      const rawTitle = titleSpan ? (titleSpan.textContent || '').trim() : '';

      // Extract time from native element or text
      const timeEl = chip.querySelector('.gVNoLb');
      let timeStr = timeEl ? (timeEl.textContent || '').trim() : '';
      if (!timeStr) {
        const timeMatch = allText.match(/(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})/);
        if (timeMatch) timeStr = `${timeMatch[1]} – ${timeMatch[2]}`;
      }

      // Extract location if present
      const locEl = chip.querySelector('.K9QN7e');
      let locStr = locEl ? (locEl.textContent || '').trim() : '';
      if (!locStr) {
        const locMatch = allText.match(/Ubicaci[oó]n:\s*([^,]+)/i);
        if (locMatch && !/sin ubicaci/i.test(locMatch[1])) {
          locStr = locMatch[1].trim();
        }
      }

      // Parse components: 1 Tipo, 2 Asignatura, 3 Título
      let type: EventType = 'EXAMEN';
      if (/calendario:\s*[^,]*ent[er]gra/i.test(allText) || /\[ENTREGA\]/i.test(allText) || /entrega|entegra|deadline|assignment|due|devoir/i.test(allText)) {
        type = 'ENTREGA';
      } else if (/calendario:\s*[^,]*exam/i.test(allText) || /\[EXAMEN\]/i.test(allText) || /ex[aá]men|exam|parcial|control|quiz|klausur|pr[üu]fung/i.test(allText)) {
        type = 'EXAMEN';
      } else if (/entrega|entegra|deadline|assignment|due/i.test(allText)) {
        type = 'ENTREGA';
      }

      let emoji = type === 'ENTREGA' ? '🗓️' : '📋';
      let subject = '';
      let title = rawTitle;

      const m = rawTitle.match(/^\[?(EXAMEN|ENTREGA)\]?\s*[:-]?\s*(.*?)\s*[-·–]\s*(.+)$/i);
      if (m) {
        type = m[1].toUpperCase() as EventType;
        emoji = type === 'ENTREGA' ? '🗓️' : '📋';
        subject = m[2].trim();
        title = m[3].trim();
      } else {
        const m2 = rawTitle.match(/^\[?(EXAMEN|ENTREGA)\]?\s*(.+)$/i);
        if (m2) {
          type = m2[1].toUpperCase() as EventType;
          emoji = type === 'ENTREGA' ? '🗓️' : '📋';
          title = m2[2].trim();
        }
      }

      // Extract description & cached subject from isolated storage if available
      let cachedDesc = '';
      let cachedTermKey = '';
      try {
        const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
        const cleanKey = title.toLowerCase().trim();
        const fullKey = `${cleanKey}_${subject.toLowerCase().trim()}`;
        cachedDesc = meta[fullKey]?.description || meta[cleanKey]?.description || '';
        cachedTermKey = meta[fullKey]?.termKey || meta[cleanKey]?.termKey || '';
        if (!subject && (meta[cleanKey]?.subject || meta[fullKey]?.subject)) {
          subject = meta[cleanKey]?.subject || meta[fullKey]?.subject || '';
        }
      } catch (_) {}

      // If subject is still empty, match from allText pattern or detected classes
      if (!subject) {
        const matchAll = allText.match(/\[?(EXAMEN|ENTREGA)\]?\s*[:-]?\s*([^\n\r,–-]+?)\s*[-·–]\s*([^\n\r,]+)/i);
        if (matchAll) {
          subject = matchAll[2].trim();
        }
      }

      if (!subject) {
        const cleanAll = this.normalizeStr(allText);
        for (const className of this.getDetectedClasses()) {
          const cleanClass = this.normalizeStr(className);
          if (cleanClass && cleanAll.includes(cleanClass)) {
            subject = className;
            break;
          }
        }

        if (!subject) {
          for (const [key] of colorMap.entries()) {
            if (key.length >= 3 && cleanAll.includes(key)) {
              subject = key.charAt(0).toUpperCase() + key.slice(1);
              break;
            }
          }
          if (!subject) {
            subject = 'Asignatura General';
          }
        }
      }

      // Filter academic chips by active period when user has configured term subjects
      if (this.hasExplicitTermSubjects()) {
        const activeConfigured = this.getConfiguredSubjects();
        let activeTermKey = '';
        try {
          const rawPlan = getIsolatedItem('gcal_academic_plan');
          if (rawPlan) {
            const p = JSON.parse(rawPlan);
            if (p && p.currentYear && p.currentPeriod) {
              activeTermKey = `Y${p.currentYear}-P${p.currentPeriod}`;
            }
          }
        } catch (_) {}

        const matchesActiveSubject = this.matchesConfiguredSubject(subject, activeConfigured);
        const explicitlyCreatedInActiveTerm = Boolean(
          activeTermKey && cachedTermKey && cachedTermKey === activeTermKey
        );

        if (explicitlyCreatedInActiveTerm || matchesActiveSubject) {
          chip.removeAttribute('data-gcal-inactive-term');
        } else {
          const belongsToOtherTermByKey = Boolean(
            activeTermKey && cachedTermKey && cachedTermKey !== activeTermKey
          );
          const belongsToOtherTermBySubj =
            subject !== 'Asignatura General' &&
            (activeConfigured.length === 0 || this.isArchivedInOtherTerm(subject, activeConfigured));

          if (belongsToOtherTermByKey || belongsToOtherTermBySubj) {
            chip.setAttribute('data-gcal-inactive-term', 'true');
            return;
          } else {
            chip.removeAttribute('data-gcal-inactive-term');
          }
        }
      } else {
        chip.removeAttribute('data-gcal-inactive-term');
      }

      const finalDesc = cachedDesc || (locStr && !/sin ubicaci/i.test(locStr) ? locStr : '');
      const descIcon = '📝';

      // Find subject's native class calendar color
      const subjectColor = this.findSubjectColor(subject, colorMap);
      const [h, s] = this.parseColorToHsl(subjectColor);

      const isEntrega = type === 'ENTREGA';

      // Opción 1:
      // EXAMEN: Sólido Intenso saturado del color de la asignatura con letra blanca
      // ENTREGA: Pastel Colorido del color de la asignatura con borde grueso y letra negra
      const examBg = this.hslToHex(h, Math.max(s, 65), 28);
      const examBorder = '#ffe082';

      const entregaPastelBg = this.hslToHex(h, Math.max(s, 58), 78);
      const entregaBorder = this.hslToHex(h, Math.max(s, 70), 38);

      const cardBg = isEntrega ? entregaPastelBg : examBg;
      const accentBorderColor = isEntrega ? entregaBorder : examBorder;
      const textColor = isEntrega ? '#000000' : '#ffffff';
      const textSubColor = isEntrega ? 'rgba(0, 0, 0, 0.78)' : 'rgba(255, 255, 255, 0.88)';
      const badgeBg = isEntrega ? 'rgba(0, 0, 0, 0.10)' : 'rgba(0, 0, 0, 0.35)';
      const timeBg = isEntrega ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.22)';

      // Check if this entrega is completed / in modo oculto
      let isCompleted = false;
      try {
        const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
        const cleanKey = title.toLowerCase().trim();
        const fullKey = `${cleanKey}_${subject.toLowerCase().trim()}`;
        const evId = chip.getAttribute('data-eventid') || '';
        if (meta[evId]?.completed || meta[fullKey]?.completed || meta[cleanKey]?.completed) {
          isCompleted = true;
        }
      } catch (_) {}

      if (isCompleted) {
        chip.classList.add('gcal-chip-dimmed');
      } else {
        chip.classList.remove('gcal-chip-dimmed');
      }

      const textHash = `v7_${type}_${subject}_${subjectColor}_${isCompleted ? 'dimmed' : 'active'}_${allText.slice(0, 160)}`;
      if (chip.getAttribute('data-gcal-enhanced') === textHash && chip.querySelector('.custom-academic-container')) {
        return;
      }
      chip.setAttribute('data-gcal-enhanced', textHash);

      const stdContent = chip.querySelector<HTMLElement>('.Jcb6qd');
      if (stdContent) {
        stdContent.style.setProperty('display', 'none', 'important');
        stdContent.style.visibility = 'hidden';
        stdContent.style.opacity = '0';
      }
      const ariaContent = chip.querySelector<HTMLElement>('.XuJrye');
      if (ariaContent) {
        ariaContent.style.setProperty('display', 'none', 'important');
        ariaContent.style.visibility = 'hidden';
        ariaContent.style.opacity = '0';
      }

      let container = chip.querySelector<HTMLElement>('.custom-academic-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'custom-academic-container';
        chip.appendChild(container);
      }
      container.style.backgroundColor = cardBg;
      container.style.boxShadow = isEntrega ? '0 1px 4px rgba(0, 0, 0, 0.2)' : '0 1px 4px rgba(0, 0, 0, 0.3)';

      const rect = chip.getBoundingClientRect();
      const chipHeight = rect.height || 100;
      const isCompact = chipHeight < 68;

      safeSetInnerHTML(
        container,
        `
        <div style="width: 100%; height: 100%; box-sizing: border-box; padding: ${isCompact ? '4px 6px' : '6px 8px'}; display: flex; flex-direction: column; gap: 3px; font-family: 'Google Sans', Roboto, -apple-system, sans-serif; color: ${textColor}; ${isEntrega ? `border: 2px solid ${accentBorderColor}; border-left: 5.5px solid ${accentBorderColor};` : `border-left: 4.5px solid ${accentBorderColor};`} border-radius: inherit;">
          
          <!-- 1: Tipo Badge -->
          <div style="display: flex; align-items: center; justify-content: space-between; line-height: 1;">
            <span style="background: ${isCompleted ? '#1e7e34' : badgeBg}; color: ${isCompleted ? '#ffffff' : textColor}; padding: 2px 6px; border-radius: 4px; font-size: ${isCompact ? '8.5px' : '9.5px'}; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
              ${isCompleted ? '✓ HECHA' : `${emoji} ${escapeHtml(type)}`}
            </span>
            ${isCompact && timeStr ? `<span style="font-size: 9.5px; opacity: 0.9; font-weight: 600; color: ${textColor};">${escapeHtml(timeStr)}</span>` : ''}
          </div>

          <!-- 2: Asignatura -->
          ${subject ? `
            <div style="font-size: ${isCompact ? '9.5px' : '11px'}; color: ${textSubColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; line-height: 1.25;">
              ${escapeHtml(subject)}
            </div>
          ` : ''}

          <!-- 3: Título Destacado Protagonista -->
          <div style="font-size: ${isCompact ? '11.5px' : '13.5px'}; font-weight: 700; color: ${textColor}; ${isCompleted ? 'text-decoration: line-through; opacity: 0.85;' : ''} white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25;">
            ${escapeHtml(title)}
          </div>

          <!-- 4: Descripción / Ubicación -->
          ${!isCompact && finalDesc ? `
            <div style="font-size: 10.5px; color: ${textSubColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25; display: flex; align-items: center; gap: 4px;">
              <span>${descIcon}</span> <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(finalDesc)}</span>
            </div>
          ` : ''}

          <!-- 5: Horas -->
          ${!isCompact && timeStr ? `
            <div style="margin-top: auto; font-size: 10.5px; color: ${textColor}; font-weight: 600; display: flex; align-items: center; gap: 4px; background: ${timeBg}; padding: 2px 6px; border-radius: 4px; width: fit-content; line-height: 1.2;">
              <span>⏱️</span> ${escapeHtml(timeStr)}
            </div>
          ` : ''}

        </div>
      `
      );
    });
  }

  private setupSelectionGuard(): void {
    if (typeof document === 'undefined' || this.selectionListener) return;
    this.selectionListener = () => {
      try {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const anchor = sel.anchorNode;
        const el = anchor instanceof Element ? anchor : anchor?.parentElement;
        if (
          el &&
          el.closest('[role="main"]') &&
          !el.closest('input, textarea, [contenteditable="true"], [role="textbox"], [role="dialog"]')
        ) {
          sel.removeAllRanges();
        }
      } catch (_) {}
    };
    document.addEventListener('selectionchange', this.selectionListener);
  }

  public destroy(): void {
    if (this.selectionListener && typeof document !== 'undefined') {
      document.removeEventListener('selectionchange', this.selectionListener);
      this.selectionListener = null;
    }
    if (this.chipPollInterval) {
      clearInterval(this.chipPollInterval);
      this.chipPollInterval = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    GoogleCalendarAdapter.instance = null;
  }
}
