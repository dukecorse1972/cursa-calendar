import { PREDEFINED_PALETTES, ColorPalette, getPaletteById } from '../../shared/palettes';
import { GoogleCalendarAdapter } from '../adapter/GoogleCalendarAdapter';
import { safeSetInnerHTML, escapeHtml, setupFocusTrap } from '../utils/dom';
import { getIsolatedItem, setIsolatedItem } from '../utils/storage';
import {
  AcademicPlanConfig,
  PeriodRegime,
  getAcademicPlan,
  saveAcademicPlan,
  getPeriodsPerYearForRegime,
  formatPeriodLabel,
  formatPeriodUnit,
  getTermKey,
  getTermsArchive,
  saveTermSnapshotToArchive,
  isTermCompleted,
  setTermCompleted,
  persistActiveSubjectsAndColors,
  switchToTerm,
  advanceToNextTerm,
  exportPortableBackup,
  downloadPortableBackupFile,
  importPortableBackup
} from '../services/academicPlanService';
import { GradesModule } from './grades/gradesModule';
import { GradesSimulatorView } from './grades/gradesSimulatorView';

export interface SubjectConfig {
  name: string;
  color: string;
}

const REGIME_OPTIONS: { id: PeriodRegime; label: string; badge: string }[] = [
  { id: 'cuatrimestre', label: 'Cuatrimestral', badge: '2/año' },
  { id: 'semestre', label: 'Semestral', badge: '2/año' },
  { id: 'trimestre', label: 'Trimestral', badge: '3/año' },
  { id: 'anual', label: 'Anual', badge: '1/año' }
];

export class OnboardingModal {
  private static instance: OnboardingModal | null = null;
  private modalOverlay: HTMLElement | null = null;
  private selectedPaletteId: string = 'mildliner';
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private focusTrapCleanup: (() => void) | null = null;
  private isEditMode: boolean = false;
  private isPlanEditorOpen: boolean = false;
  private isPaletteMenuOpen: boolean = false;
  private isPrefsOpen: boolean = false;
  private hideBirthdays: boolean = true;
  private showOtherCalendars: boolean = true;
  private ensureAcademicCalendars: boolean = false;
  private academicPlan: AcademicPlanConfig = getAcademicPlan();
  private subjects: SubjectConfig[] = [
    { name: 'Matemáticas', color: '#98D5E8' },
    { name: 'Física', color: '#A1D0CA' },
    { name: 'Programación', color: '#FFB6D9' },
    { name: 'Economía', color: '#F0F4A3' }
  ];

  public static getInstance(): OnboardingModal {
    if (!OnboardingModal.instance) {
      OnboardingModal.instance = new OnboardingModal();
    }
    return OnboardingModal.instance;
  }

  private constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      this.academicPlan = getAcademicPlan();

      const storedPalette = getIsolatedItem('gcal_active_palette');
      if (storedPalette) {
        this.selectedPaletteId = storedPalette;
      }

      const storedSubjects = getIsolatedItem('gcal_academic_subjects');
      if (storedSubjects !== null) {
        const parsed = JSON.parse(storedSubjects);
        if (Array.isArray(parsed)) {
          this.subjects = parsed;
        }
      } else {
        this.applyPaletteColorsToSubjects();
        const detected = GoogleCalendarAdapter.getInstance().getDetectedClasses();
        const isDefaultMock =
          this.subjects.length === 4 &&
          this.subjects.every((s) => ['Matemáticas', 'Física', 'Programación', 'Economía'].includes(s.name));
        if (
          isDefaultMock &&
          detected.length > 0 &&
          !detected.every((d) => ['Matemáticas', 'Física', 'Programación', 'Economía'].includes(d))
        ) {
          const palette = getPaletteById(this.selectedPaletteId);
          this.subjects = detected.map((name, idx) => ({
            name,
            color: palette.colors[idx % palette.colors.length].hex
          }));
        }
      }

      const storedBirthdays = getIsolatedItem('gcal_hide_birthdays');
      this.hideBirthdays = storedBirthdays === null ? true : storedBirthdays !== 'false';
      const storedOtherCalendars = getIsolatedItem('gcal_show_other_calendars');
      this.showOtherCalendars = storedOtherCalendars === null ? true : storedOtherCalendars !== 'false';
      const storedEnsureCals = getIsolatedItem('gcal_academic_calendars_ensured');
      this.ensureAcademicCalendars = storedEnsureCals === 'true';
    } catch (_) {}
  }

  private applyPaletteColorsToSubjects(): void {
    const palette = getPaletteById(this.selectedPaletteId);
    this.subjects.forEach((sub, idx) => {
      const colorItem = palette.colors[idx % palette.colors.length];
      sub.color = colorItem.hex;
    });
  }

  public open(isEditMode: boolean = false): void {
    this.isEditMode = isEditMode;
    this.loadFromStorage();
    // Auto-expand career structure drawer only on first-ever unconfigured onboarding
    const hasConfiguredPlan = getIsolatedItem('gcal_academic_plan') !== null;
    this.isPlanEditorOpen = !isEditMode && !hasConfiguredPlan;
    this.isPaletteMenuOpen = false;
    this.isPrefsOpen = false;
    this.cleanupOverlayAndListeners();
    this.injectBentoStyles();
    this.render();
    this.modalOverlay
      ?.querySelector<HTMLElement>('.cursa-ob-year-row[data-current-year="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }

  public markCompleted(): void {
    try {
      setIsolatedItem('gcal_academic_onboarding_completed', 'true');
    } catch (_) {}
  }

  private cleanupListenersOnly(): void {
    if (this.focusTrapCleanup) {
      this.focusTrapCleanup();
      this.focusTrapCleanup = null;
    }
    if (this.escHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
  }

  private cleanupOverlayAndListeners(): void {
    this.cleanupListenersOnly();
    if (this.modalOverlay) {
      this.modalOverlay.remove();
      this.modalOverlay = null;
    }
    if (typeof document !== 'undefined') {
      document.querySelectorAll('#gcal-onboarding-modal-overlay').forEach((el) => el.remove());
    }
  }

  public close(): void {
    const wasOpen = Boolean(this.modalOverlay);
    if (wasOpen) {
      this.syncInputsToState();
      this.persistLiveState();
    }
    this.markCompleted();
    this.cleanupOverlayAndListeners();
    if (wasOpen) {
      this.refreshHostViews();
    }
  }

  private persistLiveState(): void {
    try {
      const validSubjects = this.subjects.filter((s) => s && typeof s.name === 'string' && s.name.trim().length > 0);
      persistActiveSubjectsAndColors(validSubjects, this.selectedPaletteId);
      setIsolatedItem('gcal_hide_birthdays', String(this.hideBirthdays));
      setIsolatedItem('gcal_show_other_calendars', String(this.showOtherCalendars));
      setIsolatedItem('gcal_academic_calendars_ensured', String(this.ensureAcademicCalendars));
      this.academicPlan = saveAcademicPlan(this.academicPlan);
      saveTermSnapshotToArchive(this.academicPlan, validSubjects, this.selectedPaletteId);
    } catch (_) {}
  }

  private injectBentoStyles(): void {
    if (typeof document === 'undefined') return;
    const styleId = 'gcal-onboarding-bento-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #gcal-onboarding-modal-overlay {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(15, 23, 42, 0.62);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        font-family: 'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        box-sizing: border-box;
        padding: 16px;
      }

      #gcal-onboarding-card {
        background: var(--gcal-surface, #ffffff);
        color: var(--gcal-text, #1f1f1f);
        border: 1px solid var(--gcal-border, #dadce0);
        border-radius: 20px;
        width: 100%;
        max-width: 820px;
        max-height: 88vh;
        box-shadow: 0 24px 54px rgba(0, 0, 0, 0.32);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-sizing: border-box;
      }

      .cursa-ob-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 24px 14px 24px;
        border-bottom: 1px solid var(--gcal-border, #dadce0);
        flex-shrink: 0;
      }

      .cursa-ob-header-btn {
        padding: 6px 11px;
        border-radius: 8px;
        border: 1px solid var(--gcal-border, #dadce0);
        background: var(--gcal-surface, #ffffff);
        color: var(--gcal-text, #1f1f1f);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .cursa-ob-header-btn:hover {
        background: var(--gcal-surface-hover, #f1f3f4);
      }
      .cursa-ob-header-btn--accent {
        border-color: var(--gcal-accent, #1a73e8);
        background: var(--gcal-selected, rgba(26, 115, 232, 0.1));
        color: var(--gcal-accent, #1a73e8);
      }
      .cursa-ob-header-btn--accent:hover {
        filter: brightness(0.97);
      }

      .cursa-ob-close-btn {
        background: transparent;
        border: none;
        color: var(--gcal-secondary-text, #5f6368);
        width: 32px;
        height: 32px;
        border-radius: 8px;
        font-size: 17px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .cursa-ob-close-btn:hover {
        background: var(--gcal-surface-hover, #f1f3f4);
        color: var(--gcal-text, #1f1f1f);
      }

      .cursa-ob-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        padding: 10px 24px;
        background: var(--gcal-surface-hover, #f8fafd);
        border-bottom: 1px solid var(--gcal-border, #dadce0);
        flex-shrink: 0;
        position: relative;
      }

      .cursa-ob-pill-trigger {
        height: 34px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid var(--gcal-border, #dadce0);
        background: var(--gcal-surface, #ffffff);
        color: var(--gcal-text, #1f1f1f);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .cursa-ob-pill-trigger:hover,
      .cursa-ob-pill-trigger[data-open="true"] {
        border-color: var(--gcal-accent, #1a73e8);
      }
      .cursa-ob-pill-trigger[data-open="true"] {
        background: var(--gcal-selected, rgba(26, 115, 232, 0.1));
        color: var(--gcal-accent, #1a73e8);
      }

      .cursa-ob-plan-drawer {
        padding: 12px 24px;
        background: var(--gcal-surface, #ffffff);
        border-bottom: 1px solid var(--gcal-border, #dadce0);
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 18px;
        align-items: center;
        flex-shrink: 0;
      }

      .cursa-ob-palette-popover {
        position: absolute;
        top: calc(100% + 6px);
        right: 24px;
        width: 340px;
        max-width: calc(100vw - 48px);
        background: var(--gcal-surface, #ffffff);
        border: 1px solid var(--gcal-border, #dadce0);
        border-radius: 14px;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.24);
        padding: 10px;
        z-index: 10020;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .cursa-ob-bento-grid {
        display: grid;
        grid-template-columns: 256px minmax(0, 1fr);
        gap: 16px;
        padding: 16px 24px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      @media (max-width: 680px) {
        .cursa-ob-bento-grid {
          grid-template-columns: 1fr;
          overflow-y: auto;
        }
        .cursa-ob-plan-drawer {
          grid-template-columns: 1fr;
        }
      }

      .cursa-ob-bento-panel {
        border: 1px solid var(--gcal-border, #dadce0);
        border-radius: 14px;
        background: var(--gcal-surface, #ffffff);
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }

      .cursa-ob-bento-panel--muted {
        background: var(--gcal-surface-hover, #f8fafd);
      }

      .cursa-ob-panel-hdr {
        padding: 11px 14px;
        border-bottom: 1px solid var(--gcal-border, #dadce0);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-shrink: 0;
      }

      .cursa-ob-scroll-area {
        padding: 10px 12px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .cursa-ob-scroll-area::-webkit-scrollbar {
        width: 6px;
      }
      .cursa-ob-scroll-area::-webkit-scrollbar-thumb {
        background: rgba(128, 134, 139, 0.32);
        border-radius: 3px;
      }

      .cursa-ob-year-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 9px;
        border: 1px solid transparent;
        transition: background 0.14s ease, border-color 0.14s ease;
      }
      .cursa-ob-year-row[data-current-year="true"] {
        background: var(--gcal-surface, #ffffff);
        border-color: var(--gcal-border, #dadce0);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }

      .gcal-term-slot-btn {
        flex: 1;
        min-width: 46px;
        height: 28px;
        padding: 0 7px;
        border-radius: 7px;
        font-size: 11.5px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        transition: all 0.14s ease;
      }
      .gcal-term-slot-btn:hover:not([data-active-term="true"]) {
        border-color: var(--gcal-accent, #1a73e8) !important;
      }

      .gcal-subject-row {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--gcal-surface, #ffffff);
        border: 1px solid var(--gcal-border, #dadce0);
        border-radius: 10px;
        padding: 6px 10px;
        transition: border-color 0.14s ease;
      }
      .gcal-subject-row:focus-within {
        border-color: var(--gcal-accent, #1a73e8);
      }

      .gcal-subj-remove-btn {
        background: transparent;
        border: none;
        color: var(--gcal-secondary-text, #9aa0a6);
        cursor: pointer;
        font-size: 13.5px;
        padding: 4px 7px;
        border-radius: 6px;
        opacity: 0.7;
        transition: color 0.14s ease, background 0.14s ease, opacity 0.14s ease;
      }
      .gcal-subj-remove-btn:hover {
        color: #d93025;
        background: rgba(217, 48, 37, 0.08);
        opacity: 1;
      }

      .cursa-ob-prefs-toggle {
        width: 100%;
        padding: 9px 14px;
        border: none;
        border-top: 1px solid var(--gcal-border, #dadce0);
        background: var(--gcal-surface-hover, #f8fafd);
        color: var(--gcal-secondary-text, #5f6368);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        text-align: left;
        flex-shrink: 0;
        transition: color 0.14s ease;
      }
      .cursa-ob-prefs-toggle:hover {
        color: var(--gcal-text, #1f1f1f);
      }

      .cursa-ob-complete-btn {
        height: 26px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1.5px solid var(--gcal-border, #dadce0);
        background: var(--gcal-surface, #ffffff);
        color: var(--gcal-secondary-text, #5f6368);
        font-size: 11.5px;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }
      .cursa-ob-complete-btn:hover:not([data-completed="true"]) {
        border-color: #2e9e4b;
        color: #2e9e4b;
        background: rgba(52, 168, 83, 0.08);
      }
      .cursa-ob-complete-btn[data-completed="true"] {
        border-color: #1e8e3e;
        background: #1e8e3e;
        color: #ffffff;
        box-shadow: 0 2px 6px rgba(30, 142, 62, 0.28);
      }
      .cursa-ob-complete-btn[data-completed="true"]:hover {
        filter: brightness(0.95);
      }

      .cursa-ob-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 24px;
        border-top: 1px solid var(--gcal-border, #dadce0);
        background: var(--gcal-surface, #ffffff);
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  private renderCareerTimelineMap(): string {
    const archive = getTermsArchive();
    const { totalYears, periodsPerYear, currentYear, currentPeriod, periodType } = this.academicPlan;

    const rows: string[] = [];
    for (let y = 1; y <= totalYears; y++) {
      const isCurrentYear = y === currentYear;
      const periodButtons: string[] = [];

      for (let p = 1; p <= periodsPerYear; p++) {
        const isCurrentTerm = isCurrentYear && p === currentPeriod;
        const termKey = getTermKey(y, p);
        const snap = archive[termKey];
        const isCompleted = Boolean(snap?.completed);
        const subjCount = isCurrentTerm
          ? this.subjects.filter((s) => s.name && s.name.trim()).length
          : snap?.subjects?.length || 0;
        const hasSubjects = subjCount > 0;
        const shortUnit = formatPeriodUnit(periodType, p, true);
        const fullLabel = formatPeriodLabel(this.academicPlan, y, p, false);

        const borderColor = isCompleted
          ? isCurrentTerm
            ? '#1e8e3e'
            : 'rgba(52, 168, 83, 0.65)'
          : isCurrentTerm
            ? 'var(--gcal-accent, #1a73e8)'
            : 'var(--gcal-border, #dadce0)';

        const bgColor = isCompleted
          ? isCurrentTerm
            ? '#1e8e3e'
            : 'rgba(52, 168, 83, 0.13)'
          : isCurrentTerm
            ? 'var(--gcal-accent, #1a73e8)'
            : 'var(--gcal-surface, #ffffff)';

        const textColor = isCurrentTerm
          ? '#ffffff'
          : isCompleted
            ? '#2e9e4b'
            : 'var(--gcal-text, #1f1f1f)';

        const shadowStyle = isCurrentTerm
          ? isCompleted
            ? '0 2px 6px rgba(30, 142, 62, 0.32)'
            : '0 2px 6px rgba(26, 115, 232, 0.28)'
          : 'none';

        const countColor = isCurrentTerm
          ? '#ffffff'
          : isCompleted
            ? '#2e9e4b'
            : 'var(--gcal-secondary-text, #5f6368)';

        const statusSuffix = isCompleted
          ? ` · Completado${hasSubjects ? ` (${subjCount} asignatura(s))` : ''}`
          : hasSubjects
            ? ` · ${subjCount} asignatura(s)`
            : ' · Vacío';

        periodButtons.push(`
          <button
            type="button"
            class="gcal-term-slot-btn"
            data-term-year="${y}"
            data-term-period="${p}"
            data-completed="${isCompleted}"
            ${isCurrentTerm ? 'data-active-term="true"' : ''}
            title="${escapeHtml(fullLabel)}${statusSuffix}"
            style="
              border: 1.5px solid ${borderColor};
              background: ${bgColor};
              color: ${textColor};
              font-weight: ${isCurrentTerm || isCompleted ? '700' : '600'};
              box-shadow: ${shadowStyle};
            "
          >
            ${isCompleted ? '<span style="font-size: 10.5px; line-height: 1;">✓</span>' : ''}
            <span>${escapeHtml(shortUnit)}</span>
            ${
              hasSubjects
                ? `<span style="font-size: 9.5px; font-weight: 700; opacity: ${isCurrentTerm ? '0.92' : '0.88'}; color: ${countColor};">·${subjCount}</span>`
                : ''
            }
          </button>
        `);
      }

      rows.push(`
        <div class="cursa-ob-year-row" data-current-year="${isCurrentYear}">
          <span style="
            font-size: 12px;
            font-weight: ${isCurrentYear ? '700' : '600'};
            color: ${isCurrentYear ? 'var(--gcal-accent, #1a73e8)' : 'var(--gcal-secondary-text, #5f6368)'};
            min-width: 48px;
            user-select: none;
          ">${y}º Año</span>
          <div style="display: flex; gap: 5px; flex: 1;">
            ${periodButtons.join('')}
          </div>
        </div>
      `);
    }

    return rows.join('');
  }

  private renderPalettePopover(): string {
    return `
      <div id="gcal-palettes-popover" class="cursa-ob-palette-popover" style="display: ${this.isPaletteMenuOpen ? 'flex' : 'none'};">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.4px; color: var(--gcal-secondary-text, #5f6368); padding: 2px 4px;">
          SELECCIONAR PALETA DE ESTUDIO
        </div>
        <div id="gcal-palettes-grid" style="display: flex; flex-direction: column; gap: 6px;">
          ${PREDEFINED_PALETTES.map((pal) => {
            const isSelected = pal.id === this.selectedPaletteId;
            return `
              <div class="gcal-palette-card" data-palette-id="${pal.id}" style="
                padding: 9px 11px;
                border-radius: 10px;
                border: 1.5px solid ${isSelected ? 'var(--gcal-accent, #1a73e8)' : 'var(--gcal-border, #dadce0)'};
                background: ${isSelected ? 'var(--gcal-selected, rgba(26, 115, 232, 0.1))' : 'var(--gcal-surface, #ffffff)'};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                transition: all 0.14s ease;
              ">
                <div style="min-width: 0;">
                  <div style="font-size: 12.5px; font-weight: 700; color: var(--gcal-text, #1f1f1f); display: flex; align-items: center; gap: 5px;">
                    <span>${escapeHtml(pal.name)}</span>
                    ${isSelected ? '<span style="color: var(--gcal-accent, #1a73e8);">✓</span>' : ''}
                  </div>
                  <div style="font-size: 10.5px; color: var(--gcal-secondary-text, #5f6368); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(pal.subtitle)}
                  </div>
                </div>
                <div style="display: flex; gap: 4px; flex-shrink: 0;">
                  ${pal.colors
                    .slice(0, 5)
                    .map(
                      (c) => `
                    <span style="
                      width: 14px;
                      height: 14px;
                      border-radius: 50%;
                      background-color: ${c.hex};
                      display: inline-block;
                      border: 1px solid rgba(0,0,0,0.1);
                    " title="${escapeHtml(c.name)}"></span>
                  `
                    )
                    .join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private render(): void {
    this.cleanupListenersOnly();
    this.injectBentoStyles();

    const prevLeftScroll = this.modalOverlay?.querySelector<HTMLElement>('#gcal-years-scroll')?.scrollTop || 0;
    const prevRightScroll = this.modalOverlay?.querySelector<HTMLElement>('#gcal-subjects-scroll')?.scrollTop || 0;

    if (!this.modalOverlay || !document.body.contains(this.modalOverlay)) {
      document.querySelectorAll('#gcal-onboarding-modal-overlay').forEach((el) => el.remove());
      this.modalOverlay = document.createElement('div');
      this.modalOverlay.id = 'gcal-onboarding-modal-overlay';
      document.body.appendChild(this.modalOverlay);
    }

    const activePalette = getPaletteById(this.selectedPaletteId);
    const activePeriodLabel = formatPeriodLabel(this.academicPlan);
    const regimeObj = REGIME_OPTIONS.find((r) => r.id === this.academicPlan.periodType) || REGIME_OPTIONS[0];
    const planSummaryText = `${this.academicPlan.totalYears} ${this.academicPlan.totalYears === 1 ? 'Año' : 'Años'} · ${regimeObj.label}`;

    const isAtFinalTerm =
      this.academicPlan.currentYear >= this.academicPlan.totalYears &&
      this.academicPlan.currentPeriod >= this.academicPlan.periodsPerYear;

    let nextTermShortLabel = '';
    let nextTermFullLabel = '';
    if (!isAtFinalTerm) {
      const nextY =
        this.academicPlan.currentPeriod < this.academicPlan.periodsPerYear
          ? this.academicPlan.currentYear
          : this.academicPlan.currentYear + 1;
      const nextP =
        this.academicPlan.currentPeriod < this.academicPlan.periodsPerYear
          ? this.academicPlan.currentPeriod + 1
          : 1;
      nextTermShortLabel = formatPeriodLabel(this.academicPlan, nextY, nextP, true);
      nextTermFullLabel = formatPeriodLabel(this.academicPlan, nextY, nextP, false);
    }

    const validSubjCount = this.subjects.filter((s) => s.name && s.name.trim()).length;
    const isActiveCompleted = isTermCompleted(
      this.academicPlan.currentYear,
      this.academicPlan.currentPeriod
    );

    safeSetInnerHTML(
      this.modalOverlay,
      `
      <div id="gcal-onboarding-card">
        <!-- 1. Compact Header with Portable Backup Actions -->
        <div class="cursa-ob-header">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div style="
              width: 36px;
              height: 36px;
              border-radius: 10px;
              background: var(--gcal-selected, rgba(26, 115, 232, 0.12));
              color: var(--gcal-accent, #1a73e8);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 18px;
              flex-shrink: 0;
            ">🎓</div>
            <div style="min-width: 0;">
              <h2 style="margin: 0; font-size: 17.5px; font-weight: 700; color: var(--gcal-text, #1f1f1f); line-height: 1.2;">
                ${this.isEditMode ? 'Ajustes de Curso' : 'Configuración Inicial de Cursa'}
              </h2>
              <div style="font-size: 12px; color: var(--gcal-secondary-text, #5f6368); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                Periodo activo: <strong id="gcal-active-period-badge" style="color: ${isActiveCompleted ? '#2e9e4b' : 'var(--gcal-accent, #1a73e8)'};">${escapeHtml(activePeriodLabel)}${isActiveCompleted ? ' ✓' : ''}</strong>
              </div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 7px; flex-shrink: 0;">
            <input type="file" id="gcal-backup-file-input" accept=".json,.cursa.json" style="display: none;" />
            <button id="gcal-import-backup-btn" type="button" class="cursa-ob-header-btn" title="Restaurar copia de seguridad portátil (.cursa.json)">
              <span>📤</span> <span>Importar</span>
            </button>
            <button id="gcal-export-backup-btn" type="button" class="cursa-ob-header-btn cursa-ob-header-btn--accent" title="Descargar copia de seguridad portátil (.cursa.json)">
              <span>📥</span> <span>Exportar .cursa</span>
            </button>
            <button id="gcal-onboarding-close" type="button" class="cursa-ob-close-btn" title="Cerrar (Esc)">✕</button>
          </div>
        </div>

        <!-- 2. Compact Control Strip: Career Structure Pill + Palette Dropdown Trigger -->
        <div class="cursa-ob-strip">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 11.5px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.4px;">Plan:</span>
            <button
              id="gcal-plan-editor-toggle"
              type="button"
              class="cursa-ob-pill-trigger"
              data-open="${this.isPlanEditorOpen}"
              title="Configurar duración en años y tipo de periodos"
            >
              <span>${escapeHtml(planSummaryText)}</span>
              <span style="font-size: 11px; opacity: 0.75;">✎</span>
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 11.5px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.4px;">Paleta:</span>
            <button
              id="gcal-palette-dropdown-toggle"
              type="button"
              class="cursa-ob-pill-trigger"
              data-open="${this.isPaletteMenuOpen}"
              title="Cambiar paleta de color de tus asignaturas"
            >
              <span style="display: inline-flex; gap: 3px; align-items: center;">
                ${activePalette.colors
                  .slice(0, 4)
                  .map(
                    (c) => `<span style="width: 11px; height: 11px; border-radius: 50%; background: ${c.hex}; border: 1px solid rgba(0,0,0,0.12);"></span>`
                  )
                  .join('')}
              </span>
              <span>${escapeHtml(activePalette.name)}</span>
              <span style="font-size: 10px; opacity: 0.75;">▾</span>
            </button>
          </div>

          ${this.renderPalettePopover()}
        </div>

        <!-- Collapsible Career Structure Drawer (only visible when editing structure) -->
        <div id="gcal-plan-editor-drawer" class="cursa-ob-plan-drawer" style="display: ${this.isPlanEditorOpen ? 'grid' : 'none'};">
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <span style="font-size: 11px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.4px;">
              Años de duración
            </span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              ${[1, 2, 3, 4, 5, 6, 7, 8]
                .map((yr) => {
                  const isSel = yr === this.academicPlan.totalYears;
                  return `
                  <button
                    type="button"
                    class="gcal-plan-years-btn"
                    data-years="${yr}"
                    style="
                      min-width: 29px;
                      height: 27px;
                      padding: 0 6px;
                      border-radius: 7px;
                      border: 1.5px solid ${isSel ? 'var(--gcal-accent, #1a73e8)' : 'var(--gcal-border, #dadce0)'};
                      background: ${isSel ? 'var(--gcal-accent, #1a73e8)' : 'var(--gcal-surface, #ffffff)'};
                      color: ${isSel ? '#ffffff' : 'var(--gcal-text, #1f1f1f)'};
                      font-size: 12px;
                      font-weight: ${isSel ? '700' : '600'};
                      cursor: pointer;
                    "
                  >${yr}</button>
                `;
                })
                .join('')}
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 5px;">
            <span style="font-size: 11px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.4px;">
              División por año
            </span>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${REGIME_OPTIONS.map((reg) => {
                const isSel = reg.id === this.academicPlan.periodType;
                return `
                  <button
                    type="button"
                    class="gcal-plan-regime-btn"
                    data-regime="${reg.id}"
                    style="
                      height: 27px;
                      padding: 0 10px;
                      border-radius: 7px;
                      border: 1.5px solid ${isSel ? 'var(--gcal-accent, #1a73e8)' : 'var(--gcal-border, #dadce0)'};
                      background: ${isSel ? 'var(--gcal-selected, rgba(26, 115, 232, 0.12))' : 'var(--gcal-surface, #ffffff)'};
                      color: ${isSel ? 'var(--gcal-accent, #1a73e8)' : 'var(--gcal-text, #1f1f1f)'};
                      font-size: 11.5px;
                      font-weight: ${isSel ? '700' : '600'};
                      cursor: pointer;
                      display: inline-flex;
                      align-items: center;
                      gap: 5px;
                    "
                  >
                    <span>${escapeHtml(reg.label)}</span>
                    <span style="font-size: 10px; opacity: 0.72;">${escapeHtml(reg.badge)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- 3. Bento 2-Column Workspace: Left (Periods Map) | Right (Active Period Subjects) -->
        <div class="cursa-ob-bento-grid">
          <!-- Left Bento Panel: Mapa de Periodos -->
          <div class="cursa-ob-bento-panel cursa-ob-bento-panel--muted">
            <div class="cursa-ob-panel-hdr">
              <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase;">
                Mapa de Periodos
              </span>
              <span style="font-size: 10.5px; color: var(--gcal-secondary-text, #5f6368);">
                Pulsa para cambiar
              </span>
            </div>

            <div id="gcal-years-scroll" class="cursa-ob-scroll-area">
              ${this.renderCareerTimelineMap()}
            </div>

            <!-- Advance Term Footer inside Left Panel -->
            <div style="
              padding: 10px 12px;
              border-top: 1px solid var(--gcal-border, #dadce0);
              background: var(--gcal-surface, #ffffff);
              display: flex;
              flex-direction: column;
              gap: 7px;
              flex-shrink: 0;
            ">
              ${
                !isAtFinalTerm
                  ? `
                <button
                  id="gcal-advance-next-term-btn"
                  type="button"
                  style="
                    width: 100%;
                    padding: 7px 10px;
                    border-radius: 8px;
                    border: 1px solid var(--gcal-accent, #1a73e8);
                    background: var(--gcal-selected, rgba(26, 115, 232, 0.1));
                    color: var(--gcal-accent, #1a73e8);
                    font-size: 12px;
                    font-weight: 700;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                  "
                  title="Archiva este periodo y avanza a ${escapeHtml(nextTermFullLabel)}"
                >
                  <span>⏭️ Pasar a ${escapeHtml(nextTermShortLabel)}</span>
                </button>
              `
                  : `
                <div style="font-size: 11.5px; font-weight: 700; color: #34a853; text-align: center; padding: 3px 0;">
                  🎉 Último periodo del plan
                </div>
              `
              }
              <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--gcal-secondary-text, #5f6368); cursor: pointer; user-select: none;">
                <input
                  type="checkbox"
                  id="gcal-auto-backup-on-advance"
                  ${this.academicPlan.autoBackupOnAdvance ? 'checked' : ''}
                  style="cursor: pointer; accent-color: var(--gcal-accent, #1a73e8); margin: 0;"
                />
                <span>Auto-copia <code>.cursa</code> al pasar</span>
              </label>
            </div>
          </div>

          <!-- Right Bento Panel: Asignaturas del Periodo Activo -->
          <div class="cursa-ob-bento-panel">
            <div class="cursa-ob-panel-hdr">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span style="font-size: 11.5px; font-weight: 700; letter-spacing: 0.4px; color: var(--gcal-text, #1f1f1f); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  📚 Asignaturas · ${escapeHtml(formatPeriodLabel(this.academicPlan, undefined, undefined, true))}
                </span>
                <span id="gcal-subjects-count-badge" style="
                  font-size: 11px;
                  font-weight: 600;
                  color: var(--gcal-secondary-text, #5f6368);
                  background: var(--gcal-surface-hover, #f1f3f4);
                  padding: 2px 8px;
                  border-radius: 999px;
                  flex-shrink: 0;
                ">
                  ${validSubjCount} ${validSubjCount === 1 ? 'materia' : 'materias'}
                </span>
              </div>

              <button
                id="gcal-toggle-term-completed-btn"
                type="button"
                class="cursa-ob-complete-btn"
                data-completed="${isActiveCompleted}"
                title="${isActiveCompleted ? 'Periodo completado · Pulsa para desmarcar' : 'Marcar este periodo como completado'}"
              >
                <span>${isActiveCompleted ? '✓' : '○'}</span>
                <span>Completado</span>
              </button>
            </div>

            <div id="gcal-subjects-scroll" class="cursa-ob-scroll-area" style="padding: 12px 14px; gap: 8px;">
              <div id="gcal-subjects-list" style="display: flex; flex-direction: column; gap: 7px;">
                ${this.renderSubjectRows(activePalette, activePeriodLabel)}
              </div>

              <button id="gcal-add-subject-btn" type="button" style="
                margin-top: 2px;
                padding: 8px 12px;
                border-radius: 9px;
                border: 1px dashed var(--gcal-border, #dadce0);
                background: var(--gcal-surface-hover, #f8fafd);
                color: var(--gcal-accent, #1a73e8);
                font-size: 12.5px;
                font-weight: 600;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                width: 100%;
                box-sizing: border-box;
              ">+ Añadir asignatura</button>
            </div>

            <!-- Collapsible Advanced Preferences Accordion -->
            <button id="gcal-prefs-toggle-btn" type="button" class="cursa-ob-prefs-toggle">
              <span>${this.isPrefsOpen ? '▾' : '▸'} Opciones avanzadas de visualización</span>
              <span style="font-size: 10.5px; opacity: 0.75;">Cumpleaños y calendarios</span>
            </button>
            <div id="gcal-prefs-body" style="
              display: ${this.isPrefsOpen ? 'flex' : 'none'};
              flex-direction: column;
              gap: 7px;
              padding: 10px 14px 12px 14px;
              background: var(--gcal-surface-hover, #f8fafd);
              border-top: 1px solid var(--gcal-border, #dadce0);
              flex-shrink: 0;
            ">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gcal-text, #1f1f1f); cursor: pointer;">
                <input type="checkbox" id="gcal-pref-hide-birthdays" ${this.hideBirthdays ? 'checked' : ''} style="cursor: pointer; accent-color: var(--gcal-accent, #1a73e8);" />
                <span>Ocultar calendario de Cumpleaños</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gcal-text, #1f1f1f); cursor: pointer;">
                <input type="checkbox" id="gcal-pref-show-other-calendars" ${this.showOtherCalendars ? 'checked' : ''} style="cursor: pointer; accent-color: var(--gcal-accent, #1a73e8);" />
                <span>Mostrar sección 'Otros calendarios' (suscripciones o festivos)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gcal-text, #1f1f1f); cursor: pointer;">
                <input type="checkbox" id="gcal-pref-ensure-calendars" ${this.ensureAcademicCalendars ? 'checked' : ''} style="cursor: pointer; accent-color: var(--gcal-accent, #1a73e8);" />
                <span>Crear calendarios 'Exámenes' y 'Entregas' en Google Calendar</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Error Banner (only when import fails) -->
        <div id="gcal-onboarding-error" style="
          display: none;
          margin: 0 24px 10px 24px;
          font-size: 12px;
          color: #d93025;
          font-weight: 600;
          background: #fce8e6;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #fad2cf;
          flex-shrink: 0;
        "></div>

        <!-- 4. Clean Footer -->
        <div class="cursa-ob-footer">
          <span style="font-size: 11.5px; color: var(--gcal-secondary-text, #5f6368);">
            Guardado automático por periodo activo
          </span>

          <div style="display: flex; align-items: center; gap: 10px;">
            <button id="gcal-onboarding-cancel" type="button" style="
              padding: 8px 16px;
              border-radius: 9px;
              border: 1px solid var(--gcal-border, #dadce0);
              background: transparent;
              color: var(--gcal-text, #1f1f1f);
              font-weight: 600;
              font-size: 12.5px;
              cursor: pointer;
            ">${this.isEditMode ? 'Cerrar' : 'Omitir'}</button>

            <button id="gcal-onboarding-submit" type="button" style="
              padding: 8px 20px;
              border-radius: 9px;
              border: none;
              background: var(--gcal-accent, #1a73e8);
              color: #ffffff;
              font-weight: 600;
              font-size: 12.5px;
              cursor: pointer;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              box-shadow: 0 2px 6px rgba(26, 115, 232, 0.3);
            ">
              <span>${this.isEditMode ? 'Guardar y Cerrar ✓' : 'Comenzar con Cursa ➔'}</span>
            </button>
          </div>
        </div>
      </div>
      `
    );

    const leftScrollEl = this.modalOverlay.querySelector<HTMLElement>('#gcal-years-scroll');
    if (leftScrollEl && prevLeftScroll > 0) {
      leftScrollEl.scrollTop = prevLeftScroll;
    }
    const rightScrollEl = this.modalOverlay.querySelector<HTMLElement>('#gcal-subjects-scroll');
    if (rightScrollEl && prevRightScroll > 0) {
      rightScrollEl.scrollTop = prevRightScroll;
    }

    this.focusTrapCleanup = setupFocusTrap(this.modalOverlay);
    this.setupListeners();
  }

  private renderSubjectRows(palette: ColorPalette, activePeriodLabel: string): string {
    if (this.subjects.length === 0) {
      return `
        <div style="
          padding: 28px 16px;
          border-radius: 10px;
          border: 1px dashed var(--gcal-border, #dadce0);
          background: var(--gcal-surface-hover, #f8fafd);
          color: var(--gcal-secondary-text, #5f6368);
          font-size: 12.5px;
          text-align: center;
          line-height: 1.5;
        ">
          Sin asignaturas en <strong>${escapeHtml(activePeriodLabel)}</strong>.<br/>
          Pulsa <strong>+ Añadir asignatura</strong> para configurar las materias de este periodo.
        </div>
      `;
    }

    return this.subjects
      .map((sub, index) => {
        return `
        <div class="gcal-subject-row" data-index="${index}">
          <span style="
            font-size: 11px;
            font-weight: 700;
            color: var(--gcal-secondary-text, #5f6368);
            width: 18px;
            text-align: right;
            user-select: none;
            flex-shrink: 0;
          ">${index + 1}.</span>

          <div style="position: relative; flex-shrink: 0;">
            <button type="button" class="gcal-subj-color-dot" data-index="${index}" style="
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background-color: ${sub.color};
              border: 2px solid var(--gcal-surface, #ffffff);
              box-shadow: 0 0 0 1px var(--gcal-border, #dadce0);
              cursor: pointer;
              display: block;
              padding: 0;
            " title="Cambiar color"></button>

            <div class="gcal-swatch-popover" data-index="${index}" style="
              display: none;
              position: fixed;
              background: var(--gcal-surface, #ffffff);
              border: 1px solid var(--gcal-border, #dadce0);
              border-radius: 10px;
              padding: 7px;
              box-shadow: 0 8px 24px rgba(0,0,0,0.22);
              z-index: 10030;
              gap: 5px;
            ">
              ${palette.colors
                .map(
                  (c) => `
                <span class="gcal-swatch-opt" data-index="${index}" data-color="${c.hex}" style="
                  width: 18px;
                  height: 18px;
                  border-radius: 50%;
                  background: ${c.hex};
                  cursor: pointer;
                  display: inline-block;
                  border: 1px solid rgba(0,0,0,0.1);
                " title="${escapeHtml(c.name)}"></span>
              `
                )
                .join('')}
            </div>
          </div>

          <input
            type="text"
            class="gcal-subj-name-input"
            data-index="${index}"
            value="${escapeHtml(sub.name)}"
            placeholder="Nombre de la asignatura (ej. Álgebra, Física...)"
            style="
              flex: 1;
              min-width: 0;
              border: none;
              background: transparent;
              color: var(--gcal-text, #1f1f1f);
              font-size: 13px;
              font-weight: 500;
              outline: none;
              padding: 3px 2px;
            "
          />

          <button type="button" class="gcal-subj-remove-btn" data-index="${index}" title="Quitar asignatura de este periodo">✕</button>
        </div>
      `;
      })
      .join('');
  }

  private refreshHostViews(): void {
    if (typeof document === 'undefined') return;
    const adapter = GoogleCalendarAdapter.getInstance();
    adapter.injectCleanLayoutStyles();
    adapter.tagCalendarRows();
    adapter.enhanceAcademicChips();

    if (GradesModule.getInstance().isViewActive()) {
      const content = document.querySelector('#cursa-grades-view-content') as HTMLElement | null;
      if (content) {
        GradesSimulatorView.getInstance().mount(content);
      } else {
        GradesSimulatorView.getInstance().render();
      }
    }
  }

  private setupListeners(): void {
    if (!this.modalOverlay) return;

    const closeBtn = this.modalOverlay.querySelector('#gcal-onboarding-close');
    const cancelBtn = this.modalOverlay.querySelector('#gcal-onboarding-cancel');
    const submitBtn = this.modalOverlay.querySelector('#gcal-onboarding-submit');
    const addBtn = this.modalOverlay.querySelector('#gcal-add-subject-btn');
    const advanceBtn = this.modalOverlay.querySelector('#gcal-advance-next-term-btn');
    const exportBtn = this.modalOverlay.querySelector('#gcal-export-backup-btn');
    const importBtn = this.modalOverlay.querySelector('#gcal-import-backup-btn');
    const fileInput = this.modalOverlay.querySelector<HTMLInputElement>('#gcal-backup-file-input');
    const planToggleBtn = this.modalOverlay.querySelector('#gcal-plan-editor-toggle');
    const paletteToggleBtn = this.modalOverlay.querySelector('#gcal-palette-dropdown-toggle');
    const prefsToggleBtn = this.modalOverlay.querySelector('#gcal-prefs-toggle-btn');
    const completeTermBtn = this.modalOverlay.querySelector('#gcal-toggle-term-completed-btn');

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    cancelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    completeTermBtn?.addEventListener('click', () => {
      this.syncInputsToState();
      const nextCompleted = !isTermCompleted(
        this.academicPlan.currentYear,
        this.academicPlan.currentPeriod
      );
      setTermCompleted(
        this.academicPlan.currentYear,
        this.academicPlan.currentPeriod,
        nextCompleted,
        this.subjects,
        this.selectedPaletteId
      );
      this.refreshHostViews();
      this.render();
      const label = formatPeriodLabel(this.academicPlan);
      this.showToast(
        nextCompleted
          ? `✅ ${label} marcado como completado`
          : `↩️ ${label} desmarcado como completado`
      );
    });

    // Top Strip Toggles (Plan Drawer & Palette Popover & Preferences Accordion)
    planToggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.syncInputsToState();
      this.isPlanEditorOpen = !this.isPlanEditorOpen;
      this.isPaletteMenuOpen = false;
      this.render();
    });

    paletteToggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.syncInputsToState();
      this.isPaletteMenuOpen = !this.isPaletteMenuOpen;
      this.render();
    });

    prefsToggleBtn?.addEventListener('click', () => {
      this.syncInputsToState();
      this.isPrefsOpen = !this.isPrefsOpen;
      this.render();
    });

    // Live input persistence on subject name typing & preference checkboxes
    const nameInputs = this.modalOverlay.querySelectorAll<HTMLInputElement>('.gcal-subj-name-input');
    nameInputs.forEach((inp) => {
      inp.addEventListener('input', () => {
        this.syncInputsToState();
        this.persistLiveState();
        const liveCount = this.subjects.filter((s) => s.name && s.name.trim()).length;
        const countBadge = this.modalOverlay?.querySelector('#gcal-subjects-count-badge');
        if (countBadge) {
          countBadge.textContent = `${liveCount} ${liveCount === 1 ? 'materia' : 'materias'}`;
        }
      });
    });

    const subjectsScroll = this.modalOverlay.querySelector('#gcal-subjects-scroll');
    subjectsScroll?.addEventListener('scroll', () => {
      this.modalOverlay?.querySelectorAll<HTMLElement>('.gcal-swatch-popover').forEach((p) => {
        p.style.display = 'none';
      });
    });

    const prefCheckboxes = this.modalOverlay.querySelectorAll<HTMLInputElement>(
      '#gcal-auto-backup-on-advance, #gcal-pref-hide-birthdays, #gcal-pref-show-other-calendars, #gcal-pref-ensure-calendars'
    );
    prefCheckboxes.forEach((cb) => {
      cb.addEventListener('change', () => {
        this.syncInputsToState();
        this.persistLiveState();
        this.refreshHostViews();
      });
    });

    // Career totalYears selector
    const yearBtns = this.modalOverlay.querySelectorAll('.gcal-plan-years-btn');
    yearBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const yrs = parseInt(btn.getAttribute('data-years') || '4', 10);
        this.syncInputsToState();
        this.academicPlan = saveAcademicPlan({
          ...this.academicPlan,
          totalYears: yrs,
          currentYear: Math.min(this.academicPlan.currentYear, yrs)
        });
        this.persistLiveState();
        this.render();
      });
    });

    // Career periodType regime selector
    const regimeBtns = this.modalOverlay.querySelectorAll('.gcal-plan-regime-btn');
    regimeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const regime = btn.getAttribute('data-regime') as PeriodRegime | null;
        if (!regime) return;
        this.syncInputsToState();
        const perYear = getPeriodsPerYearForRegime(regime);
        this.academicPlan = saveAcademicPlan({
          ...this.academicPlan,
          periodType: regime,
          periodsPerYear: perYear,
          currentPeriod: Math.min(this.academicPlan.currentPeriod, perYear)
        });
        this.persistLiveState();
        this.render();
      });
    });

    // Left Bento Panel: Switch to any Year + Period
    const termSlotBtns = this.modalOverlay.querySelectorAll('.gcal-term-slot-btn');
    termSlotBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetYear = parseInt(btn.getAttribute('data-term-year') || '1', 10);
        const targetPeriod = parseInt(btn.getAttribute('data-term-period') || '1', 10);
        if (
          targetYear === this.academicPlan.currentYear &&
          targetPeriod === this.academicPlan.currentPeriod
        ) {
          return;
        }
        this.syncInputsToState();
        const switched = switchToTerm(
          targetYear,
          targetPeriod,
          this.subjects,
          this.selectedPaletteId
        );
        this.academicPlan = switched.plan;
        this.subjects = switched.subjects;
        this.selectedPaletteId = switched.paletteId;
        this.isPaletteMenuOpen = false;
        this.refreshHostViews();
        this.render();
        const label = formatPeriodLabel(this.academicPlan);
        this.showToast(
          switched.restoredFromArchive
            ? `📂 ${label} cargado (${this.subjects.length} asignatura(s))`
            : `✨ ${label} activo`
        );
      });
    });

    // Advance to next term ("Pasar de cuatri")
    advanceBtn?.addEventListener('click', () => {
      this.syncInputsToState();
      const result = advanceToNextTerm(this.subjects, this.selectedPaletteId);
      this.academicPlan = result.plan;
      this.subjects = result.subjects;
      this.selectedPaletteId = result.paletteId;

      if (this.academicPlan.autoBackupOnAdvance) {
        downloadPortableBackupFile(result.backup);
      }

      this.refreshHostViews();
      this.render();
      this.showToast(
        `⏭️ Guardado ${result.previousTermLabel} ➔ ${result.newTermLabel}`
      );
    });

    // Portable Backup Export & Import
    exportBtn?.addEventListener('click', () => {
      this.syncInputsToState();
      const backup = exportPortableBackup(this.subjects, this.selectedPaletteId);
      const fileName = downloadPortableBackupFile(backup);
      this.render();
      this.showToast(`📥 Copia exportada (${fileName})`);
    });

    importBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const restored = importPortableBackup(text);
        this.academicPlan = restored.plan;
        this.subjects = restored.subjects;
        this.selectedPaletteId = restored.paletteId;
        this.loadFromStorage();
        this.refreshHostViews();
        this.render();
        this.showToast(
          `📤 Copia restaurada: ${formatPeriodLabel(this.academicPlan)} (${restored.subjects.length} materias)`
        );
      } catch (err: any) {
        const errorEl = this.modalOverlay?.querySelector('#gcal-onboarding-error') as HTMLElement | null;
        if (errorEl) {
          errorEl.textContent = err?.message || 'Error al importar el archivo .cursa.json';
          errorEl.style.display = 'block';
        }
      } finally {
        fileInput.value = '';
      }
    });

    // Palette option click inside popover
    const paletteCards = this.modalOverlay.querySelectorAll('.gcal-palette-card');
    paletteCards.forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const palId = card.getAttribute('data-palette-id');
        if (!palId) return;
        this.selectedPaletteId = palId;
        this.isPaletteMenuOpen = false;
        this.syncInputsToState();
        this.applyPaletteColorsToSubjects();
        this.persistLiveState();
        this.refreshHostViews();
        this.render();
      });
    });

    // Add subject button
    addBtn?.addEventListener('click', () => {
      this.syncInputsToState();
      const palette = getPaletteById(this.selectedPaletteId);
      const nextColor = palette.colors[this.subjects.length % palette.colors.length].hex;
      this.subjects.push({ name: '', color: nextColor });
      this.render();
      setTimeout(() => {
        const inputs = this.modalOverlay?.querySelectorAll<HTMLInputElement>('.gcal-subj-name-input');
        if (inputs && inputs.length > 0) {
          const lastInput = inputs[inputs.length - 1];
          lastInput.scrollIntoView({ block: 'nearest' });
          lastInput.focus();
        }
      }, 30);
    });

    // Remove subject button
    const removeBtns = this.modalOverlay.querySelectorAll('.gcal-subj-remove-btn');
    removeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index') || '0', 10);
        this.syncInputsToState();
        this.subjects.splice(idx, 1);
        this.persistLiveState();
        this.refreshHostViews();
        this.render();
      });
    });

    // Fixed-viewport Color Swatch Popover (immune to scroll container clipping)
    const colorDots = this.modalOverlay.querySelectorAll<HTMLElement>('.gcal-subj-color-dot');
    colorDots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = dot.getAttribute('data-index');
        const popover = this.modalOverlay?.querySelector<HTMLElement>(`.gcal-swatch-popover[data-index="${idx}"]`);
        if (popover) {
          const isOpen = popover.style.display === 'flex';
          this.modalOverlay?.querySelectorAll<HTMLElement>('.gcal-swatch-popover').forEach((p) => {
            p.style.display = 'none';
          });
          if (!isOpen) {
            const rect = dot.getBoundingClientRect();
            const spaceBelow = (typeof window !== 'undefined' ? window.innerHeight : 800) - rect.bottom;
            popover.style.left = `${Math.max(12, rect.left)}px`;
            if (spaceBelow < 60) {
              popover.style.top = `${Math.max(12, rect.top - 40)}px`;
            } else {
              popover.style.top = `${rect.bottom + 6}px`;
            }
            popover.style.display = 'flex';
          }
        }
      });
    });

    const swatchOpts = this.modalOverlay.querySelectorAll('.gcal-swatch-opt');
    swatchOpts.forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(opt.getAttribute('data-index') || '0', 10);
        const color = opt.getAttribute('data-color');
        if (color && this.subjects[idx]) {
          this.subjects[idx].color = color;
          this.syncInputsToState();
          this.persistLiveState();
          this.refreshHostViews();
          this.render();
        }
      });
    });

    // Dismiss floating popovers on inner card click; close modal on backdrop click
    this.modalOverlay.onclick = (e: MouseEvent) => {
      this.modalOverlay?.querySelectorAll<HTMLElement>('.gcal-swatch-popover').forEach((p) => {
        p.style.display = 'none';
      });
      const palettePopover = this.modalOverlay?.querySelector('#gcal-palettes-popover');
      if (this.isPaletteMenuOpen && palettePopover && !palettePopover.contains(e.target as Node)) {
        this.isPaletteMenuOpen = false;
        palettePopover.setAttribute('style', 'display: none;');
        this.modalOverlay?.querySelector('#gcal-palette-dropdown-toggle')?.setAttribute('data-open', 'false');
      }
      if (e.target === this.modalOverlay) {
        this.close();
      }
    };

    // Escape key closes open floating menus first or exits modal cleanly
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const openSwatches = Array.from(
          this.modalOverlay?.querySelectorAll<HTMLElement>('.gcal-swatch-popover') || []
        ).filter((p) => p.style.display === 'flex');
        if (openSwatches.length > 0) {
          openSwatches.forEach((p) => {
            p.style.display = 'none';
          });
          return;
        }
        if (this.isPaletteMenuOpen) {
          this.isPaletteMenuOpen = false;
          this.render();
          return;
        }
        this.close();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.escHandler);
    }

    submitBtn?.addEventListener('click', () => this.handleSubmit());
  }

  private syncInputsToState(): void {
    if (!this.modalOverlay) return;
    const inputs = this.modalOverlay.querySelectorAll<HTMLInputElement>('.gcal-subj-name-input');
    inputs.forEach((input) => {
      const idx = parseInt(input.getAttribute('data-index') || '0', 10);
      if (this.subjects[idx]) {
        this.subjects[idx].name = input.value.trim();
      }
    });

    const autoBackupCheckbox = this.modalOverlay.querySelector<HTMLInputElement>('#gcal-auto-backup-on-advance');
    if (autoBackupCheckbox) {
      this.academicPlan.autoBackupOnAdvance = autoBackupCheckbox.checked;
      this.academicPlan = saveAcademicPlan(this.academicPlan);
    }

    const hideBirthdaysCheckbox = this.modalOverlay.querySelector<HTMLInputElement>('#gcal-pref-hide-birthdays');
    if (hideBirthdaysCheckbox) {
      this.hideBirthdays = hideBirthdaysCheckbox.checked;
    }
    const showOtherCalCheckbox = this.modalOverlay.querySelector<HTMLInputElement>('#gcal-pref-show-other-calendars');
    if (showOtherCalCheckbox) {
      this.showOtherCalendars = showOtherCalCheckbox.checked;
    }
    const ensureCalCheckbox = this.modalOverlay.querySelector<HTMLInputElement>('#gcal-pref-ensure-calendars');
    if (ensureCalCheckbox) {
      this.ensureAcademicCalendars = ensureCalCheckbox.checked;
    }
  }

  private async handleSubmit(): Promise<void> {
    this.syncInputsToState();
    this.subjects = this.subjects.filter((s) => s.name.length > 0);
    this.persistLiveState();

    const desktopApi = typeof window !== 'undefined' ? (window as any).gcalDesktopAPI : null;
    if (this.ensureAcademicCalendars && desktopApi && typeof desktopApi.ensureAcademicCalendarsBackground === 'function') {
      try {
        desktopApi.ensureAcademicCalendarsBackground(['Exámenes', 'Entregas']);
      } catch (_) {}
    }

    const activePeriod = formatPeriodLabel(this.academicPlan);
    this.showToast(`✓ ¡Curso actualizado (${activePeriod})!`);
    this.close();
  }

  private showToast(msg: string): void {
    if (typeof document === 'undefined') return;
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      z-index: 1000000;
      opacity: 1;
      transition: opacity 0.3s ease;
      font-family: inherit;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }
}
