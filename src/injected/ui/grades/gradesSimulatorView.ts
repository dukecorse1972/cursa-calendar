import { safeSetInnerHTML, escapeHtml } from '../../utils/dom';
import {
  CutoffDiagnostic,
  GradeItemType,
  SimulatedGradesMap,
  SubjectGradesConfig
} from '../../../shared/gradesTypes';
import {
  getSubjectGrades,
  saveSubjectGrades,
  deleteSubjectGrades,
  createInitialSubjectGrades
} from '../../services/gradesStorage';
import {
  calculateAccumulatedScore,
  calculateScenarioSimulation,
  calculateTargetRequiredGrade,
  calculateTermSummary,
  groupGradeItems,
  normalizeWeightsTo100,
  GradeGroup,
  GradeGroupItem,
  GradeSubgroup
} from '../../../shared/gradesCalculator';
import { GoogleCalendarAdapter } from '../../adapter/GoogleCalendarAdapter';
import { GradesChatModal } from './gradesChatModal';
import { CalendarPickerMode } from './calendarPickerMode';
import { getAcademicPlan, formatPeriodLabel, isTermCompleted } from '../../services/academicPlanService';
import { OnboardingModal } from '../onboardingModal';
import { GRADES_ICONS } from './gradesIcons';
import { injectGradesStyles } from './gradesStyles';
import { ThemeManager } from '../../theme/ThemeManager';

const OVERVIEW_TAB_ID = '__CURSA_OVERVIEW__';
const BLOCK_SEGMENT_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4'];

const TYPE_CYCLE: GradeItemType[] = ['EXAMEN', 'ENTREGA', 'OTRO'];
const TYPE_LABELS: Record<GradeItemType, string> = {
  EXAMEN: 'Examen',
  ENTREGA: 'Entrega',
  OTRO: 'Otro'
};

export class GradesSimulatorView {
  private static instance: GradesSimulatorView | null = null;
  private containerEl: HTMLElement | null = null;
  private activeSubject: string = '';
  private currentConfig: SubjectGradesConfig | null = null;
  private currentTarget: number = 5.0;
  private fallbackSimScore: number = 5.0;
  private simulatedGrades: SimulatedGradesMap = {};
  private simInputModeIds: Set<string> = new Set();
  private expandedGroups: Set<string> = new Set();
  private pendingDeleteConfirm: boolean = false;
  private themeUnsubscribe: (() => void) | null = null;

  public static getInstance(): GradesSimulatorView {
    if (!GradesSimulatorView.instance) {
      GradesSimulatorView.instance = new GradesSimulatorView();
    }
    return GradesSimulatorView.instance;
  }

  private constructor() {}

  public mount(parent: HTMLElement): void {
    injectGradesStyles();
    this.containerEl = parent;
    if (!this.themeUnsubscribe) {
      this.themeUnsubscribe = ThemeManager.getInstance().onThemeChange((mode) => {
        const root = this.containerEl?.querySelector('#cursa-grades-view-root');
        if (root) {
          root.setAttribute('data-cg-theme', mode === 'DARK' ? 'dark' : 'light');
        }
      });
    }
    const detectedClasses = GoogleCalendarAdapter.getInstance().getDetectedClasses();
    if (detectedClasses.length === 0) {
      this.activeSubject = '';
      this.currentConfig = null;
      this.render();
      return;
    }
    if (
      !this.activeSubject ||
      (this.activeSubject !== OVERVIEW_TAB_ID && !detectedClasses.includes(this.activeSubject))
    ) {
      this.activeSubject = detectedClasses[0];
    }
    if (this.activeSubject === OVERVIEW_TAB_ID) {
      this.currentConfig = null;
      this.render();
    } else {
      this.loadSubject(this.activeSubject);
    }
  }

  public setActiveSubject(subject: string): void {
    this.activeSubject = subject;
    this.pendingDeleteConfirm = false;
    if (subject === OVERVIEW_TAB_ID) {
      this.currentConfig = null;
      this.render();
    } else {
      this.loadSubject(subject);
    }
  }

  private loadSubject(subject: string): void {
    this.currentConfig = getSubjectGrades(subject);
    this.simulatedGrades = {};
    this.simInputModeIds.clear();
    this.expandedGroups.clear();
    this.pendingDeleteConfirm = false;
    if (this.currentConfig) {
      const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
      groups.forEach((g) => this.expandedGroups.add(g.id));
    }
    this.render();
  }

  public render(): void {
    if (!this.containerEl) return;
    injectGradesStyles();

    const scrollTop = this.containerEl.querySelector('#cursa-grades-view-root')?.scrollTop || 0;

    const adapter = GoogleCalendarAdapter.getInstance();
    const detectedClasses = adapter.getDetectedClasses();
    const colorMap = adapter.getSubjectColorMap();
    const activePlan = getAcademicPlan();
    const activePeriodLabel = formatPeriodLabel(activePlan, activePlan.currentYear, activePlan.currentPeriod, false);
    const activeTermDone = isTermCompleted(activePlan.currentYear, activePlan.currentPeriod);

    let bodyHtml = '';
    if (detectedClasses.length === 0) {
      bodyHtml = this.renderNoSubjectsState(activePeriodLabel);
    } else if (this.activeSubject === OVERVIEW_TAB_ID) {
      bodyHtml = this.renderTermOverview(detectedClasses, adapter, colorMap, activePeriodLabel);
    } else if (!this.currentConfig) {
      bodyHtml = this.renderEmptySubjectState(adapter, colorMap);
    } else {
      bodyHtml = this.renderSimulatorContent(adapter, colorMap);
    }

    const themeMode = ThemeManager.getInstance().getTheme() === 'DARK' ? 'dark' : 'light';

    safeSetInnerHTML(
      this.containerEl,
      `
      <div id="cursa-grades-view-root" data-cg-theme="${themeMode}">
        <div class="cg-shell">
          ${this.renderNavRail(detectedClasses, adapter, colorMap, activePeriodLabel, activeTermDone)}
          ${bodyHtml}
        </div>
      </div>
    `
    );

    const root = this.containerEl.querySelector('#cursa-grades-view-root');
    if (root && scrollTop > 0) {
      root.scrollTop = scrollTop;
    }

    this.attachEvents();
  }

  private renderNavRail(
    detectedClasses: string[],
    adapter: GoogleCalendarAdapter,
    colorMap: Map<string, string>,
    activePeriodLabel: string,
    activeTermDone: boolean
  ): string {
    const isOverview = this.activeSubject === OVERVIEW_TAB_ID;

    const subjectTabsHtml = detectedClasses
      .map((subj) => {
        const isActive = subj === this.activeSubject;
        const subjColor = adapter.findSubjectColor(subj, colorMap);
        const cfg = getSubjectGrades(subj);
        let scoreBadge = '';
        if (cfg && cfg.items.length > 0) {
          const acc = calculateAccumulatedScore(cfg.items);
          const label = acc.gradedWeight > 0 ? acc.accumulatedPoints.toFixed(1) : '0.0';
          scoreBadge = `<span class="cg-tab-score">${label}</span>`;
        }
        return `
          <button type="button" class="cg-tab cursa-grade-subj-tab ${isActive ? 'active' : ''}" data-subj="${escapeHtml(subj)}">
            <span class="cg-tab-dot" style="background: ${subjColor};"></span>
            <span>${escapeHtml(subj)}</span>
            ${scoreBadge}
          </button>
        `;
      })
      .join('');

    return `
      <nav class="cg-nav-rail" aria-label="Asignaturas">
        <button type="button" id="cursa-grades-open-plan-btn" class="cg-term-pill ${activeTermDone ? 'done' : ''}" title="Cambiar de cuatrimestre o exportar copia (.cursa.json)">
          ${GRADES_ICONS.graduationCap(15)}
          <span>${escapeHtml(activePeriodLabel)}</span>
          ${activeTermDone ? GRADES_ICONS.check(13) : GRADES_ICONS.chevronDown(13)}
        </button>

        ${
          detectedClasses.length > 0
            ? `
              <div class="cg-nav-divider"></div>
              <button type="button" class="cg-tab cursa-grade-subj-tab ${isOverview ? 'active' : ''}" data-subj="${OVERVIEW_TAB_ID}">
                ${GRADES_ICONS.grid(14)}
                <span>Resumen</span>
              </button>
              ${subjectTabsHtml}
            `
            : ''
        }
      </nav>
    `;
  }

  private renderNoSubjectsState(activePeriodLabel: string): string {
    return `
      <div class="cg-empty-state">
        <div class="cg-empty-icon">${GRADES_ICONS.graduationCap(26)}</div>
        <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Sin asignaturas en ${escapeHtml(activePeriodLabel)}</h2>
        <p style="margin: 0; font-size: 13.5px; color: var(--cg-muted); max-width: 460px; line-height: 1.55;">
          Este periodo aún no tiene asignaturas configuradas. Tus datos de otros cuatrimestres están archivados de forma segura.
        </p>
        <button type="button" id="cursa-grades-empty-term-config-btn" class="cg-btn cg-btn-primary" style="margin-top: 4px;">
          Configurar asignaturas de ${escapeHtml(activePeriodLabel)}
        </button>
      </div>
    `;
  }

  private renderTermOverview(
    detectedClasses: string[],
    adapter: GoogleCalendarAdapter,
    colorMap: Map<string, string>,
    activePeriodLabel: string
  ): string {
    const entries = detectedClasses.map((subjectName) => ({
      subjectName,
      color: adapter.findSubjectColor(subjectName, colorMap),
      config: getSubjectGrades(subjectName)
    }));
    const summary = calculateTermSummary(entries);

    return `
      <div class="cg-header">
        <div class="cg-header-left">
          <div class="cg-subject-accent" style="background: var(--cg-accent);"></div>
          <div>
            <h1 class="cg-subject-title">Resumen · ${escapeHtml(activePeriodLabel)}</h1>
            <div class="cg-subject-subtitle">
              <span>${summary.configuredSubjects} de ${summary.totalSubjects} asignaturas configuradas</span>
              <span>·</span>
              <span>${summary.totalCredits} ECTS totales</span>
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 18px; align-items: center; flex-wrap: wrap;">
          <div style="text-align: right;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--cg-muted); font-weight: 600;">Media actual (ECTS)</div>
            <div class="cg-num" style="font-size: 24px; font-weight: 600; color: var(--cg-accent);">
              ${summary.weightedAverageCurrent !== null ? summary.weightedAverageCurrent.toFixed(2) : '—'}
              <span style="font-size: 12px; color: var(--cg-muted); font-weight: 500;">/ 10</span>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--cg-muted); font-weight: 600;">Asegurado (ECTS)</div>
            <div class="cg-num" style="font-size: 24px; font-weight: 600; color: var(--cg-text);">
              ${summary.weightedAssuredPoints.toFixed(2)}
              <span style="font-size: 12px; color: var(--cg-muted); font-weight: 500;">pts</span>
            </div>
          </div>
        </div>
      </div>

      <div class="cg-overview-grid">
        ${summary.subjects
          .map((s) => {
            let statusPill = `<span class="cg-pill cg-pill-neutral">Sin configurar</span>`;
            if (s.isConfigured) {
              if (s.hasCutoffFailed) {
                statusPill = `<span class="cg-pill cg-pill-danger">Corte no superado</span>`;
              } else if (s.isPassedAssured) {
                statusPill = `<span class="cg-pill cg-pill-success">Aprobado asegurado</span>`;
              } else if (s.hasCutoffRisk) {
                statusPill = `<span class="cg-pill cg-pill-warn">Corte pendiente</span>`;
              } else {
                statusPill = `<span class="cg-pill cg-pill-accent">${s.gradedWeight}% evaluado</span>`;
              }
            }

            return `
              <div class="cg-overview-card cursa-overview-card-btn" data-subj="${escapeHtml(s.subjectName)}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 9px; min-width: 0;">
                    <span class="cg-tab-dot" style="background: ${s.color}; width: 10px; height: 10px;"></span>
                    <div style="font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      ${escapeHtml(s.subjectName)}
                    </div>
                  </div>
                  <span style="font-size: 11.5px; color: var(--cg-muted); font-weight: 600; flex-shrink: 0;">${s.credits} ECTS</span>
                </div>

                ${
                  s.isConfigured
                    ? `
                      <div style="display: flex; justify-content: space-between; align-items: baseline;">
                        <div class="cg-num" style="font-size: 26px; font-weight: 600; color: var(--cg-text);">
                          ${s.accumulatedPoints.toFixed(2)}
                          <span style="font-size: 12px; color: var(--cg-muted); font-weight: 500;">pts asegurados</span>
                        </div>
                        <div class="cg-num" style="font-size: 12.5px; color: var(--cg-muted);">
                          Media: <strong style="color: var(--cg-text);">${s.currentAverage !== null ? s.currentAverage.toFixed(2) : '—'}</strong>
                        </div>
                      </div>
                      <div class="cg-progress-track">
                        <div class="cg-progress-seg" style="width: ${Math.min(100, s.accumulatedPoints * 10)}%; background: ${s.color};"></div>
                        <div class="cg-progress-marker"></div>
                      </div>
                    `
                    : `<div style="font-size: 12.5px; color: var(--cg-muted); padding: 10px 0;">Haz clic para configurar su sistema de evaluación.</div>`
                }

                <div style="display: flex; justify-content: space-between; align-items: center;">
                  ${statusPill}
                  <span style="font-size: 11.5px; color: var(--cg-muted);">${s.isConfigured ? `${s.itemCount} hitos` : 'Configurar →'}</span>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private renderEmptySubjectState(adapter: GoogleCalendarAdapter, colorMap: Map<string, string>): string {
    const subjColor = adapter.findSubjectColor(this.activeSubject, colorMap);

    return `
      <div class="cg-empty-state">
        <div class="cg-empty-icon" style="color: ${subjColor}; border-color: ${subjColor}55; background: ${subjColor}18;">
          ${GRADES_ICONS.bookOpen(24)}
        </div>
        <h2 style="margin: 0; font-size: 21px; font-weight: 600; letter-spacing: -0.02em;">
          Configura <span style="color: ${subjColor};">${escapeHtml(this.activeSubject)}</span>
        </h2>
        <p style="margin: 0; max-width: 500px; font-size: 13.5px; line-height: 1.6; color: var(--cg-muted);">
          Pega la guía docente o explícale al asistente cómo te califican. Separará bloques, temas, ponderaciones y notas de corte automáticamente.
        </p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 6px;">
          <button id="cursa-grades-open-ai-chat" type="button" class="cg-btn cg-btn-ai">
            ${GRADES_ICONS.sparkles(15)}
            <span>Configurar con Asistente IA</span>
          </button>
          <button id="cursa-grades-use-template" type="button" class="cg-btn">
            <span>Plantilla estándar (Parcial + Prácticas + Final)</span>
          </button>
          <button id="cursa-grades-start-blank" type="button" class="cg-btn cg-btn-ghost">
            <span>Empezar desde cero</span>
          </button>
        </div>
      </div>
    `;
  }

  private renderSimulatorContent(adapter: GoogleCalendarAdapter, colorMap: Map<string, string>): string {
    if (!this.currentConfig) return '';
    const config = this.currentConfig;
    const subjColor = adapter.findSubjectColor(this.activeSubject, colorMap);

    const acc = calculateAccumulatedScore(config.items);
    const targetCalc = calculateTargetRequiredGrade(
      config.items,
      this.currentTarget,
      config.minFinalGradeRequired,
      config.blockCutoffs
    );
    const simResult = calculateScenarioSimulation(
      config.items,
      this.simulatedGrades,
      this.fallbackSimScore,
      config.minFinalGradeRequired,
      config.blockCutoffs
    );

    const groups = groupGradeItems(config.items, config.blockCutoffs);
    if (this.expandedGroups.size === 0 && groups.length > 0) {
      groups.forEach((g) => this.expandedGroups.add(g.id));
    }
    const allExpanded = groups.length > 0 && groups.every((g) => this.expandedGroups.has(g.id));
    const isSum100 = Math.abs(acc.totalWeight - 100) < 0.05;

    return `
      ${this.renderSubjectHeader(config, subjColor, acc, targetCalc)}
      ${this.pendingDeleteConfirm ? this.renderDeleteConfirmBar(config.subjectName) : ''}

      <div class="cg-kpi-grid" id="cg-kpi-grid">
        ${this.renderProgressCard(acc, groups)}
        ${this.renderTargetCard(targetCalc)}
        ${this.renderScenarioCard(simResult)}
      </div>

      <div id="cg-cutoffs-strip-container">
        ${this.renderCutoffsStrip(simResult.cutoffDiagnostics)}
      </div>

      ${this.renderTreeToolbar(groups, config, allExpanded)}

      <div class="cg-blocks-stack">
        ${groups.map((group, idx) => this.renderBlockCard(group, idx)).join('')}
      </div>

      <div id="cg-weight-footer-container">
        ${this.renderWeightFooter(acc.totalWeight, isSum100, config.items.length, groups.length)}
      </div>
    `;
  }

  private renderSubjectHeader(
    config: SubjectGradesConfig,
    subjColor: string,
    acc: ReturnType<typeof calculateAccumulatedScore>,
    targetCalc: ReturnType<typeof calculateTargetRequiredGrade>
  ): string {
    const anyCutoffFailed = (targetCalc.cutoffDiagnostics || []).some(
      (d) => d.status === 'FAILED' || d.status === 'IMPOSSIBLE'
    );
    let statusBadge = `<span class="cg-pill cg-pill-accent">Faltan ${(Math.max(0, 5 - acc.accumulatedPoints)).toFixed(2)} pts para 5.0</span>`;
    if (anyCutoffFailed) {
      statusBadge = `<span class="cg-pill cg-pill-danger">${GRADES_ICONS.shieldAlert(12)} Corte no superado</span>`;
    } else if (acc.accumulatedPoints >= 5.0 && (targetCalc.cutoffDiagnostics || []).every((d) => d.status === 'MET')) {
      statusBadge = `<span class="cg-pill cg-pill-success">${GRADES_ICONS.check(12)} Aprobado asegurado</span>`;
    } else if (acc.accumulatedPoints >= 5.0) {
      statusBadge = `<span class="cg-pill cg-pill-warn">${GRADES_ICONS.shield(12)} 5.0 alcanzado · Falta corte</span>`;
    }

    return `
      <div class="cg-header">
        <div class="cg-header-left">
          <div class="cg-subject-accent" style="background: ${subjColor};"></div>
          <div style="min-width: 0;">
            <div class="cg-subject-title-row">
              <h1 class="cg-subject-title">${escapeHtml(config.subjectName)}</h1>
              <label class="cg-ects-chip" title="Créditos ECTS de la asignatura">
                <input id="cursa-credits-input" class="cg-ects-input cg-num" type="number" min="1" max="30" step="0.5" value="${config.credits || 6}" />
                <span>ECTS</span>
              </label>
              <span id="cg-header-status-pill">${statusBadge}</span>
            </div>
            <div class="cg-subject-subtitle" id="cg-header-subtitle">
              <span><strong>${acc.accumulatedPoints.toFixed(2)}</strong> pts asegurados</span>
              <span>·</span>
              <span>Media actual: <strong>${acc.currentAverage !== null ? acc.currentAverage.toFixed(2) : '—'}</strong> (${acc.gradedWeight}% evaluado)</span>
              <span>·</span>
              <span>Máx. posible: <strong>${acc.maxPossibleGrade.toFixed(2)}</strong></span>
            </div>
          </div>
        </div>

        <div class="cg-header-actions">
          <button id="cursa-add-block-btn" type="button" class="cg-btn">
            ${GRADES_ICONS.layers(14)}
            <span>+ Bloque</span>
          </button>
          <button id="cursa-add-item-btn" type="button" class="cg-btn">
            ${GRADES_ICONS.plus(14)}
            <span>Añadir hito</span>
          </button>
          <button id="cursa-reconfigure-ai-btn" type="button" class="cg-btn cg-btn-ai">
            ${GRADES_ICONS.sparkles(14)}
            <span>Asistente IA</span>
          </button>
          <button id="cursa-delete-grades-btn" type="button" class="cg-btn cg-btn-danger-ghost" title="Borrar configuración de esta asignatura">
            ${GRADES_ICONS.trash(15)}
          </button>
        </div>
      </div>
    `;
  }

  private renderDeleteConfirmBar(subjectName: string): string {
    return `
      <div class="cg-confirm-bar">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${GRADES_ICONS.alertTriangle(15)}
          <span>¿Seguro que quieres borrar todas las notas y la estructura de <strong>${escapeHtml(subjectName)}</strong>?</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="cursa-confirm-delete-cancel" type="button" class="cg-btn cg-btn-sm">Cancelar</button>
          <button id="cursa-confirm-delete-yes" type="button" class="cg-btn cg-btn-sm" style="background: var(--cg-danger); color: #fff; border-color: transparent;">
            Borrar definitivamente
          </button>
        </div>
      </div>
    `;
  }

  private renderProgressCard(
    acc: ReturnType<typeof calculateAccumulatedScore>,
    groups: GradeGroup[]
  ): string {
    const segmentsHtml = groups
      .map((g, i) => {
        const pct = Math.min(100, Math.max(0, g.accumulatedPoints * 10));
        const color = BLOCK_SEGMENT_COLORS[i % BLOCK_SEGMENT_COLORS.length];
        return `<div class="cg-progress-seg" style="width: ${pct}%; background: ${color};" title="${escapeHtml(g.name)}: +${g.accumulatedPoints.toFixed(2)} pts"></div>`;
      })
      .join('');

    return `
      <div class="cg-card" id="cg-card-progress">
        <div class="cg-card-top">
          <span class="cg-card-label">${GRADES_ICONS.layers(14)} Estado actual</span>
          <span class="cg-pill cg-pill-neutral cg-num">${acc.gradedWeight}% evaluado</span>
        </div>

        <div>
          <div class="cg-big-value">
            <span style="color: var(--cg-accent);">${acc.accumulatedPoints.toFixed(2)}</span>
            <span class="cg-big-unit">/ 10 pts asegurados</span>
          </div>
          <div class="cg-meta-row" style="margin-top: 6px;">
            <span>Media evaluada: <strong class="cg-num">${acc.currentAverage !== null ? acc.currentAverage.toFixed(2) : '—'}</strong></span>
            <span>Máx. alcanzable: <strong class="cg-num">${acc.maxPossibleGrade.toFixed(2)}</strong></span>
          </div>
        </div>

        <div>
          <div class="cg-progress-track">
            ${segmentsHtml}
            <div class="cg-progress-marker" title="Aprobado (5.0)"></div>
          </div>
          <div class="cg-meta-row" style="margin-top: 7px; font-size: 11.5px;">
            <span>${acc.accumulatedPoints >= 5.0 ? 'Umbral de 5.0 superado' : `Faltan ${(5.0 - acc.accumulatedPoints).toFixed(2)} pts para 5.0`}</span>
            <span>Línea: 5.0</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderTargetCard(targetCalc: ReturnType<typeof calculateTargetRequiredGrade>): string {
    let pillClass = 'cg-pill-success';
    let pillText = 'Factible';
    let valueColor = 'var(--cg-success)';

    if (!targetCalc.isPossible) {
      pillClass = 'cg-pill-danger';
      pillText = 'Inalcanzable';
      valueColor = 'var(--cg-danger)';
    } else if (targetCalc.requiredFinalGrade > 8.5) {
      pillClass = 'cg-pill-warn';
      pillText = 'Muy exigente';
      valueColor = 'var(--cg-warn)';
    } else if (targetCalc.requiredFinalGrade > 6.5) {
      pillClass = 'cg-pill-accent';
      pillText = 'Exigente';
      valueColor = 'var(--cg-accent)';
    }

    const targets = [5.0, 7.0, 9.0];
    const buttonsHtml = targets
      .map(
        (t) =>
          `<button type="button" class="cg-seg-btn cursa-target-btn ${this.currentTarget === t ? 'active' : ''}" data-target="${t.toFixed(1)}">${t.toFixed(1)}</button>`
      )
      .join('');

    return `
      <div class="cg-card" id="cg-card-target">
        <div class="cg-card-top">
          <span class="cg-card-label">${GRADES_ICONS.target(14)} Meta de nota</span>
          <div class="cg-seg-group">${buttonsHtml}</div>
        </div>

        <div>
          <div class="cg-big-value">
            <span style="color: ${valueColor};">
              ${targetCalc.remainingWeightTotal === 0 ? targetCalc.accumulatedPoints.toFixed(2) : targetCalc.isPossible ? targetCalc.requiredFinalGrade.toFixed(2) : 'Inalcanzable'}
            </span>
            ${
              targetCalc.remainingWeightTotal > 0 && targetCalc.isPossible
                ? `<span class="cg-big-unit">en el ${targetCalc.remainingWeightTotal}% restante</span>`
                : targetCalc.remainingWeightTotal === 0
                  ? `<span class="cg-big-unit">nota final</span>`
                  : ''
            }
          </div>
          <div style="font-size: 12px; color: var(--cg-muted); margin-top: 6px;">
            Para alcanzar un <strong style="color: var(--cg-text);">${this.currentTarget.toFixed(1)}</strong> final
            ${
              targetCalc.isCutoffTriggered && typeof targetCalc.rawRequiredForAverage === 'number'
                ? ` <span style="opacity: 0.85;">(media pura: ${targetCalc.rawRequiredForAverage.toFixed(2)})</span>`
                : ''
            }
          </div>
        </div>

        <div class="cg-meta-row">
          <span class="cg-pill ${pillClass}">${pillText}</span>
          ${
            targetCalc.bottleneckReason
              ? `<span style="font-size: 11.5px; color: ${targetCalc.isPossible ? 'var(--cg-warn)' : 'var(--cg-danger)'}; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;" title="${escapeHtml(targetCalc.bottleneckReason)}">${escapeHtml(targetCalc.bottleneckReason)}</span>`
              : `<span style="font-size: 11.5px;">Sin cortes bloqueantes</span>`
          }
        </div>
      </div>
    `;
  }

  private renderScenarioCard(sim: ReturnType<typeof calculateScenarioSimulation>): string {
    let pillClass = 'cg-pill-success';
    let pillText = 'Aprobado';
    let valueColor = 'var(--cg-success)';

    if (sim.isCutoffFailed) {
      pillClass = 'cg-pill-danger';
      pillText = sim.failedBlockCutoff ? `Corte: ${sim.failedBlockCutoff}` : 'Corte no superado';
      valueColor = 'var(--cg-danger)';
    } else if (sim.finalGrade >= 9.0) {
      pillClass = 'cg-pill-success';
      pillText = 'Sobresaliente';
      valueColor = 'var(--cg-success)';
    } else if (sim.finalGrade >= 7.0) {
      pillClass = 'cg-pill-accent';
      pillText = 'Notable';
      valueColor = 'var(--cg-accent)';
    } else if (sim.finalGrade >= 5.0) {
      pillClass = 'cg-pill-success';
      pillText = 'Aprobado';
      valueColor = 'var(--cg-success)';
    } else {
      pillClass = 'cg-pill-danger';
      pillText = 'Suspenso (< 5.0)';
      valueColor = 'var(--cg-danger)';
    }

    const hasPerItemSim = sim.simulatedItemCount > 0;

    return `
      <div class="cg-card" id="cg-card-scenario">
        <div class="cg-card-top">
          <span class="cg-card-label">${GRADES_ICONS.sliders(14)} Simulador What-If</span>
          <span id="cursa-sim-status-badge" class="cg-pill ${pillClass}" style="max-width: 190px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(pillText)}">${escapeHtml(pillText)}</span>
        </div>

        <div>
          <div class="cg-big-value" id="cursa-sim-final-grade-box" style="color: ${valueColor};">
            <span id="cursa-sim-final-grade-val">${sim.finalGrade.toFixed(2)}</span>
            <span class="cg-big-unit">nota proyectada</span>
          </div>
          <div class="cg-meta-row" style="margin-top: 6px;">
            <span>
              ${
                hasPerItemSim
                  ? `<strong style="color: var(--cg-sim);">${sim.simulatedItemCount} sim. manual${sim.simulatedItemCount > 1 ? 'es' : ''}</strong>${sim.pendingUnfilledCount > 0 ? ` · resto a <strong id="cursa-sim-score-val">${this.fallbackSimScore.toFixed(1)}</strong>` : ''}`
                  : `Resto pendiente a: <strong id="cursa-sim-score-val" style="color: var(--cg-sim);">${this.fallbackSimScore.toFixed(1)}</strong>`
              }
            </span>
            ${
              hasPerItemSim
                ? `<div style="display: inline-flex; gap: 6px;">
                    <button type="button" id="cursa-clear-sim-btn" class="cg-btn cg-btn-sm cg-btn-ghost" style="height: 22px; padding: 0 6px;" title="Limpiar notas simuladas">
                      ${GRADES_ICONS.rotateCcw(12)} Limpiar
                    </button>
                    <button type="button" id="cursa-commit-sim-btn" class="cg-btn cg-btn-sm" style="height: 22px; padding: 0 7px; color: var(--cg-sim); border-color: var(--cg-sim-border);" title="Convertir simuladas en notas reales">
                      ${GRADES_ICONS.check(12)} Fijar
                    </button>
                  </div>`
                : ''
            }
          </div>
        </div>

        <div>
          <input id="cursa-sim-slider" class="cg-slider" type="range" min="0" max="10" step="0.1" value="${this.fallbackSimScore}" />
          <div class="cg-meta-row" style="font-size: 10.5px; margin-top: 2px;">
            <span>0.0</span>
            <span>5.0</span>
            <span>10.0</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderCutoffsStrip(diagnostics: CutoffDiagnostic[]): string {
    if (!diagnostics || diagnostics.length === 0) return '';

    const chips = diagnostics
      .map((d) => {
        let cls = 'cg-pill-neutral';
        let icon = GRADES_ICONS.shield(12);
        let detail = `mín. ${d.required.toFixed(1)}`;

        if (d.status === 'MET') {
          cls = 'cg-pill-success';
          icon = GRADES_ICONS.shieldCheck(12);
          detail = d.currentScore !== null ? `${d.currentScore.toFixed(2)} ≥ ${d.required.toFixed(1)}` : `OK (≥ ${d.required.toFixed(1)})`;
        } else if (d.status === 'FAILED' || d.status === 'IMPOSSIBLE') {
          cls = 'cg-pill-danger';
          icon = GRADES_ICONS.shieldAlert(12);
          detail = d.status === 'IMPOSSIBLE' ? `inalcanzable (< ${d.required.toFixed(1)})` : `${d.currentScore?.toFixed(2) ?? '—'} < ${d.required.toFixed(1)}`;
        } else if (d.status === 'AT_RISK') {
          cls = 'cg-pill-warn';
          icon = GRADES_ICONS.shieldAlert(12);
          detail = `sim. ${d.projectedScore?.toFixed(2) ?? '—'} < ${d.required.toFixed(1)}`;
        } else if (d.requiredInPending !== null) {
          cls = 'cg-pill-warn';
          detail = `necesitas ${d.requiredInPending.toFixed(2)} (mín. ${d.required.toFixed(1)})`;
        }

        return `<span class="cg-pill ${cls} cg-num">${icon} <span>${escapeHtml(d.label)}:</span> <strong>${detail}</strong></span>`;
      })
      .join('');

    return `
      <div class="cg-cutoffs-strip">
        <span class="cg-cutoffs-title">${GRADES_ICONS.shield(13)} Reglas de corte activas:</span>
        ${chips}
      </div>
    `;
  }

  private renderTreeToolbar(
    groups: GradeGroup[],
    config: SubjectGradesConfig,
    allExpanded: boolean
  ): string {
    return `
      <div class="cg-tree-toolbar">
        <div class="cg-tree-toolbar-left">
          <span class="cg-section-title">
            ${GRADES_ICONS.layers(15)}
            <span>Desglose de evaluación</span>
          </span>
          <span class="cg-pill cg-pill-neutral">${groups.length} ${groups.length === 1 ? 'bloque' : 'bloques'} · ${config.items.length} hitos</span>
        </div>

        <div class="cg-tree-toolbar-right">
          <label class="cg-inline-field" title="Corte global opcional para el examen final">
            ${GRADES_ICONS.shield(13)}
            <span>Corte final:</span>
            <input id="cursa-cutoff-input" type="number" step="0.25" min="0" max="10" placeholder="—" value="${config.minFinalGradeRequired ?? ''}" />
          </label>

          <button id="cursa-toggle-all-groups-btn" type="button" class="cg-btn cg-btn-sm">
            ${allExpanded ? 'Contraer bloques' : 'Desplegar bloques'}
          </button>
        </div>
      </div>
    `;
  }

  private renderBlockCard(group: GradeGroup, blockIndex: number): string {
    const isExpanded = this.expandedGroups.has(group.id);
    const hasSubgroups =
      group.subgroups.length > 1 || (group.subgroups.length === 1 && Boolean(group.subgroups[0].name));
    const barColor = BLOCK_SEGMENT_COLORS[blockIndex % BLOCK_SEGMENT_COLORS.length];
    const barFillPct = Math.min(100, Math.max(0, group.blockScore * 10));

    let cutoffBadge = '';
    if (typeof group.minGradeRequired === 'number') {
      if (group.isCutoffMet) {
        cutoffBadge = `<span class="cg-pill cg-pill-success">${GRADES_ICONS.check(11)} Corte OK</span>`;
      } else if (group.isCutoffImpossible) {
        cutoffBadge = `<span class="cg-pill cg-pill-danger">Corte imposible</span>`;
      } else if (typeof group.requiredGradeInPending === 'number') {
        cutoffBadge = `<span class="cg-pill cg-pill-warn cg-num">Nec. ${group.requiredGradeInPending.toFixed(2)} para corte</span>`;
      }
    }

    return `
      <section class="cg-block ${isExpanded ? 'expanded' : ''}" data-group-id="${group.id}" data-group-name="${escapeHtml(group.name)}">
        <div class="cg-block-header cursa-accordion-header" data-group-id="${group.id}">
          <div class="cg-block-left">
            <span class="cg-chevron">${GRADES_ICONS.chevronDown(15)}</span>
            <span class="cg-tab-dot" style="background: ${barColor}; width: 9px; height: 9px;"></span>
            <input type="text" class="cg-block-name-input cursa-block-rename-input" data-old-group="${escapeHtml(group.name)}" value="${escapeHtml(group.name)}" title="Renombrar bloque" />
            <span class="cg-pill cg-pill-accent cg-num">${group.totalWeight}%</span>
            ${cutoffBadge}
          </div>

          <div class="cg-block-right">
            <label class="cg-inline-field" style="height: 26px; padding: 0 8px; font-size: 11.5px;" title="Nota mínima obligatoria en este bloque">
              ${GRADES_ICONS.shield(12)}
              <span>Mín:</span>
              <input type="number" step="0.25" min="0" max="10" placeholder="—" class="cursa-block-cutoff-input" data-group="${escapeHtml(group.name)}" value="${group.minGradeRequired ?? ''}" style="width: 36px; font-size: 11.5px;" />
            </label>

            <div class="cg-block-metrics">
              <span class="cg-block-metric" title="Media actual de los hitos ya evaluados en este bloque">
                Media: <strong>${group.internalScore !== null ? group.internalScore.toFixed(2) : '—'}</strong>
              </span>
              <span class="cg-block-metric" title="Puntos asegurados aportados a la nota final">
                Aporte: <strong style="color: var(--cg-success);">+${group.accumulatedPoints.toFixed(2)}</strong>
              </span>
            </div>

            <button type="button" class="cg-btn cg-btn-sm cg-btn-ghost cursa-add-subgroup-btn" data-group="${escapeHtml(group.name)}" title="Añadir subtema a este bloque">
              ${GRADES_ICONS.folder(13)} + Tema
            </button>
            <button type="button" class="cg-btn cg-btn-sm cursa-add-to-group-btn" data-group="${escapeHtml(group.name)}">
              ${GRADES_ICONS.plus(12)} Hito
            </button>
          </div>
        </div>

        <div class="cg-block-bar">
          <div class="cg-block-bar-fill" style="width: ${barFillPct}%; background: ${barColor};"></div>
        </div>

        ${
          isExpanded
            ? `
              <div class="cg-block-body">
                <div class="cg-col-headers">
                  <span>Tipo</span>
                  <span>Evaluación</span>
                  <span class="right">Peso</span>
                  <span class="center">Corte</span>
                  <span class="right">Nota / Sim.</span>
                  <span class="right">Aporte</span>
                  <span></span>
                </div>

                ${
                  hasSubgroups
                    ? group.subgroups
                        .map((sub) => this.renderSubtopicSection(sub, group))
                        .join('')
                    : group.items.map((itemWrap) => this.renderItemRow(itemWrap, group)).join('')
                }
              </div>
            `
            : ''
        }
      </section>
    `;
  }

  private renderSubtopicSection(sub: GradeSubgroup, group: GradeGroup): string {
    const relInGroup = group.totalWeight > 0 ? Math.round((sub.totalWeight / group.totalWeight) * 1000) / 10 : 0;

    return `
      <div class="cg-subtopic">
        <div class="cg-subtopic-header">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="color: var(--cg-muted); display: inline-flex;">${GRADES_ICONS.folder(13)}</span>
            <input type="text" class="cg-subtopic-name-input cursa-subtopic-rename-input" data-group="${escapeHtml(group.name)}" data-old-sub="${escapeHtml(sub.name)}" value="${escapeHtml(sub.name || 'General')}" title="Renombrar tema" />
            <span class="cg-pill cg-pill-neutral cg-num" style="font-size: 11px; padding: 1px 7px;">
              ${sub.totalWeight}% global · ${relInGroup}% del bloque
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="cg-num" style="font-size: 12px; color: var(--cg-muted);">
              Media: <strong style="color: var(--cg-text);">${sub.internalScore !== null ? sub.internalScore.toFixed(2) : '—'}</strong>
            </span>
            <button type="button" class="cg-btn cg-btn-sm cg-btn-ghost cursa-add-to-subgroup-btn" data-group="${escapeHtml(group.name)}" data-sub="${escapeHtml(sub.name)}">
              ${GRADES_ICONS.plus(12)} Hito
            </button>
          </div>
        </div>
        ${sub.items.map((itemWrap) => this.renderItemRow(itemWrap, group, sub)).join('')}
      </div>
    `;
  }

  private renderItemRow(itemWrap: GradeGroupItem, group: GradeGroup, sub?: GradeSubgroup): string {
    const { item, originalIndex, displayName } = itemWrap;
    const hasRealGrade = typeof item.grade === 'number' && !isNaN(item.grade);
    const hasSimGrade = !hasRealGrade && typeof this.simulatedGrades[item.id] === 'number';
    const isSimEditing = !hasRealGrade && (hasSimGrade || this.simInputModeIds.has(item.id));
    const effectiveGrade = hasRealGrade ? item.grade! : hasSimGrade ? this.simulatedGrades[item.id] : null;
    const contrib = effectiveGrade !== null ? ((effectiveGrade * item.weight) / 100).toFixed(2) : '—';

    const hasCutoff = typeof item.minGradeRequired === 'number' && !isNaN(item.minGradeRequired) && item.minGradeRequired > 0;
    const isItemCutoffFailed = hasCutoff && hasRealGrade && item.grade! < item.minGradeRequired!;

    const relPct =
      sub && sub.name && sub.totalWeight > 0
        ? Math.round((item.weight / sub.totalWeight) * 100)
        : group.totalWeight > 0 && group.name !== 'Evaluación General'
          ? Math.round((item.weight / group.totalWeight) * 100)
          : null;

    const rowClasses = ['cg-row'];
    if (hasSimGrade) rowClasses.push('has-sim');
    if (isItemCutoffFailed) rowClasses.push('cutoff-failed');

    return `
      <div class="${rowClasses.join(' ')}" data-idx="${originalIndex}" data-item-id="${escapeHtml(item.id)}">
        <div>
          <button type="button" class="cg-type-pill ${item.type} cursa-item-type-pill" data-idx="${originalIndex}" title="Clic para cambiar tipo">
            ${TYPE_LABELS[item.type]}
          </button>
        </div>

        <div class="cg-name-cell">
          <input type="text" class="cg-name-input cursa-item-name-input" data-idx="${originalIndex}" data-group="${escapeHtml(group.name)}" data-sub="${escapeHtml(sub?.name || '')}" value="${escapeHtml(displayName)}" />
          ${item.dateHint && !item.linkedCalendarEventId ? `<span class="cg-date-hint">${escapeHtml(item.dateHint)}</span>` : ''}
          ${
            item.linkedCalendarEventId
              ? `<span class="cg-cal-chip" title="${escapeHtml(item.linkedEventTitle || 'Evento vinculado')}">
                  ${GRADES_ICONS.calendar(11)}
                  <span class="txt">${escapeHtml(item.linkedEventTitle || 'Evento')}</span>
                  <button type="button" class="cg-cal-unlink cursa-unlink-btn" data-idx="${originalIndex}" title="Desvincular evento">${GRADES_ICONS.x(11)}</button>
                </span>`
              : `<button type="button" class="cg-cal-link-btn cursa-link-cal-btn" data-idx="${originalIndex}" title="Vincular a un evento de Google Calendar">
                  ${GRADES_ICONS.link(11)}
                  <span>Vincular</span>
                </button>`
          }
        </div>

        <div class="cg-weight-cell" title="${relPct !== null ? `${relPct}% dentro de ${sub?.name || group.name}` : 'Peso sobre la asignatura'}">
          <input type="number" min="0" max="100" step="0.5" class="cg-num-input cursa-item-weight-input" data-idx="${originalIndex}" value="${item.weight}" />
          <span class="cg-unit-suffix">%</span>
        </div>

        <div style="display: flex; justify-content: center;">
          <input type="number" min="0" max="10" step="0.25" placeholder="—" class="cg-cutoff-input cursa-item-cutoff-input ${hasCutoff ? 'active' : ''}" data-idx="${originalIndex}" value="${hasCutoff ? item.minGradeRequired : ''}" title="Nota mínima obligatoria en esta prueba" />
        </div>

        <div class="cg-grade-cell">
          <input
            type="number"
            step="0.05"
            min="0"
            max="10"
            placeholder="${isSimEditing ? 'Sim...' : 'Pend.'}"
            class="cg-grade-input cursa-item-grade-input ${hasRealGrade ? 'graded' : isSimEditing ? 'simulated' : ''}"
            data-idx="${originalIndex}"
            data-item-id="${escapeHtml(item.id)}"
            data-mode="${isSimEditing ? 'sim' : 'real'}"
            value="${hasRealGrade ? item.grade : hasSimGrade ? this.simulatedGrades[item.id] : ''}"
            title="${isSimEditing ? 'Nota simulada (no sobrescribe tus notas reales)' : 'Nota real obtenida (0 - 10)'}"
          />
          ${
            !hasRealGrade
              ? `<button type="button" class="cg-sim-toggle-btn cursa-sim-mode-btn ${isSimEditing ? 'active' : ''}" data-item-id="${escapeHtml(item.id)}" title="${isSimEditing ? 'Volver a modo nota real' : 'Simular nota hipotética (What-If) sin guardarla como real'}">
                  ${GRADES_ICONS.flask(13)}
                </button>`
              : `<span style="width: 26px; display: inline-block;"></span>`
          }
        </div>

        <div class="cg-contrib-cell ${hasRealGrade ? 'graded' : hasSimGrade ? 'simulated' : ''}" data-contrib-for="${escapeHtml(item.id)}">
          ${effectiveGrade !== null ? `${hasSimGrade ? '~' : '+'}${contrib}` : '—'}
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button type="button" class="cg-row-del-btn cursa-del-item-btn" data-idx="${originalIndex}" title="Eliminar hito">
            ${GRADES_ICONS.x(13)}
          </button>
        </div>
      </div>
    `;
  }

  private renderWeightFooter(
    totalWeight: number,
    isSum100: boolean,
    itemCount: number,
    groupCount: number
  ): string {
    const diff = Math.round((100 - totalWeight) * 10) / 10;
    const statusText = isSum100
      ? 'Ponderación equilibrada al 100%'
      : diff > 0
        ? `Falta asignar ${diff}%`
        : `Sobran ${Math.abs(diff)}%`;

    return `
      <div class="cg-weight-footer">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span style="color: var(--cg-muted);">Ponderación total:</span>
          <strong class="cg-num" style="font-size: 14px; color: ${isSum100 ? 'var(--cg-success)' : 'var(--cg-warn)'};">${totalWeight}%</strong>
          <span class="cg-pill ${isSum100 ? 'cg-pill-success' : 'cg-pill-warn'}">${statusText}</span>
          ${
            !isSum100 && itemCount > 0
              ? `<button type="button" id="cursa-normalize-weights-btn" class="cg-btn cg-btn-sm">
                  ${GRADES_ICONS.scale(13)} Normalizar al 100%
                </button>`
              : ''
          }
        </div>
        <span style="color: var(--cg-muted); font-size: 12px;">
          ${itemCount} ${itemCount === 1 ? 'hito' : 'hitos'} en ${groupCount} ${groupCount === 1 ? 'bloque' : 'bloques'}
        </span>
      </div>
    `;
  }

  /**
   * Surgical live update of KPI cards, cutoffs strip, header subtitle, and weight footer
   * WITHOUT destroying the active input or losing keyboard focus!
   */
  private updateLiveMetricsInPlace(): void {
    if (!this.containerEl || !this.currentConfig) return;
    const config = this.currentConfig;
    const acc = calculateAccumulatedScore(config.items);
    const targetCalc = calculateTargetRequiredGrade(
      config.items,
      this.currentTarget,
      config.minFinalGradeRequired,
      config.blockCutoffs
    );
    const simResult = calculateScenarioSimulation(
      config.items,
      this.simulatedGrades,
      this.fallbackSimScore,
      config.minFinalGradeRequired,
      config.blockCutoffs
    );
    const groups = groupGradeItems(config.items, config.blockCutoffs);
    const isSum100 = Math.abs(acc.totalWeight - 100) < 0.05;

    // Update KPI cards (preserve slider focus if user is dragging it)
    const sliderFocused = document.activeElement?.id === 'cursa-sim-slider';
    const progressEl = this.containerEl.querySelector('#cg-card-progress');
    if (progressEl) {
      const tmp = document.createElement('div');
      safeSetInnerHTML(tmp, this.renderProgressCard(acc, groups));
      if (tmp.firstElementChild) progressEl.replaceWith(tmp.firstElementChild);
    }

    const targetEl = this.containerEl.querySelector('#cg-card-target');
    if (targetEl) {
      const tmp = document.createElement('div');
      safeSetInnerHTML(tmp, this.renderTargetCard(targetCalc));
      if (tmp.firstElementChild) {
        targetEl.replaceWith(tmp.firstElementChild);
        this.bindTargetButtons();
      }
    }

    if (sliderFocused) {
      this.updateScenarioReadoutOnly(simResult);
    } else {
      const scenEl = this.containerEl.querySelector('#cg-card-scenario');
      if (scenEl) {
        const tmp = document.createElement('div');
        safeSetInnerHTML(tmp, this.renderScenarioCard(simResult));
        if (tmp.firstElementChild) {
          scenEl.replaceWith(tmp.firstElementChild);
          this.bindScenarioControls();
        }
      }
    }

    // Update cutoffs strip
    const cutoffsContainer = this.containerEl.querySelector('#cg-cutoffs-strip-container') as HTMLElement | null;
    if (cutoffsContainer) {
      safeSetInnerHTML(cutoffsContainer, this.renderCutoffsStrip(simResult.cutoffDiagnostics));
    }

    // Update header subtitle
    const subEl = this.containerEl.querySelector('#cg-header-subtitle') as HTMLElement | null;
    if (subEl) {
      safeSetInnerHTML(
        subEl,
        `<span><strong>${acc.accumulatedPoints.toFixed(2)}</strong> pts asegurados</span>
         <span>·</span>
         <span>Media actual: <strong>${acc.currentAverage !== null ? acc.currentAverage.toFixed(2) : '—'}</strong> (${acc.gradedWeight}% evaluado)</span>
         <span>·</span>
         <span>Máx. posible: <strong>${acc.maxPossibleGrade.toFixed(2)}</strong></span>`
      );
    }

    // Update weight footer
    const footerContainer = this.containerEl.querySelector('#cg-weight-footer-container') as HTMLElement | null;
    if (footerContainer) {
      safeSetInnerHTML(
        footerContainer,
        this.renderWeightFooter(acc.totalWeight, isSum100, config.items.length, groups.length)
      );
      this.bindNormalizeButton();
    }

    // Update contribution cells in-place
    config.items.forEach((item) => {
      const contribEl = this.containerEl?.querySelector(`[data-contrib-for="${CSS.escape(item.id)}"]`) as HTMLElement | null;
      if (!contribEl) return;
      const hasReal = typeof item.grade === 'number' && !isNaN(item.grade);
      const hasSim = !hasReal && typeof this.simulatedGrades[item.id] === 'number';
      const val = hasReal ? item.grade! : hasSim ? this.simulatedGrades[item.id] : null;
      contribEl.textContent = val !== null ? `${hasSim ? '~' : '+'}${((val * item.weight) / 100).toFixed(2)}` : '—';
      contribEl.className = `cg-contrib-cell ${hasReal ? 'graded' : hasSim ? 'simulated' : ''}`;
    });
  }

  private updateScenarioReadoutOnly(sim: ReturnType<typeof calculateScenarioSimulation>): void {
    if (!this.containerEl) return;
    const scoreVal = this.containerEl.querySelector('#cursa-sim-score-val');
    if (scoreVal) scoreVal.textContent = this.fallbackSimScore.toFixed(1);

    const gradeVal = this.containerEl.querySelector('#cursa-sim-final-grade-val');
    if (gradeVal) gradeVal.textContent = sim.finalGrade.toFixed(2);

    const badge = this.containerEl.querySelector('#cursa-sim-status-badge') as HTMLElement | null;
    const gradeBox = this.containerEl.querySelector('#cursa-sim-final-grade-box') as HTMLElement | null;
    let cls = 'cg-pill-success';
    let label = 'Aprobado';
    let color = 'var(--cg-success)';
    if (sim.isCutoffFailed) {
      cls = 'cg-pill-danger';
      label = sim.failedBlockCutoff ? `Corte: ${sim.failedBlockCutoff}` : 'Corte no superado';
      color = 'var(--cg-danger)';
    } else if (sim.finalGrade >= 9.0) {
      label = 'Sobresaliente';
    } else if (sim.finalGrade >= 7.0) {
      cls = 'cg-pill-accent';
      label = 'Notable';
      color = 'var(--cg-accent)';
    } else if (sim.finalGrade < 5.0) {
      cls = 'cg-pill-danger';
      label = 'Suspenso (< 5.0)';
      color = 'var(--cg-danger)';
    }
    if (badge) {
      badge.className = `cg-pill ${cls}`;
      badge.textContent = label;
    }
    if (gradeBox) gradeBox.style.color = color;
  }

  private bindTargetButtons(): void {
    this.containerEl?.querySelectorAll<HTMLButtonElement>('.cursa-target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentTarget = parseFloat(btn.getAttribute('data-target') || '5.0');
        this.updateLiveMetricsInPlace();
      });
    });
  }

  private bindScenarioControls(): void {
    const slider = this.containerEl?.querySelector('#cursa-sim-slider') as HTMLInputElement | null;
    slider?.addEventListener('input', () => {
      this.fallbackSimScore = parseFloat(slider.value);
      this.updateLiveMetricsInPlace();
    });

    this.containerEl?.querySelector('#cursa-clear-sim-btn')?.addEventListener('click', () => {
      this.simulatedGrades = {};
      this.simInputModeIds.clear();
      this.render();
    });

    this.containerEl?.querySelector('#cursa-commit-sim-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      for (const item of this.currentConfig.items) {
        if (typeof this.simulatedGrades[item.id] === 'number' && (item.grade === null || isNaN(item.grade))) {
          item.grade = this.simulatedGrades[item.id];
        }
      }
      this.simulatedGrades = {};
      this.simInputModeIds.clear();
      saveSubjectGrades(this.currentConfig);
      this.render();
    });
  }

  private bindNormalizeButton(): void {
    this.containerEl?.querySelector('#cursa-normalize-weights-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      this.currentConfig.items = normalizeWeightsTo100(this.currentConfig.items);
      saveSubjectGrades(this.currentConfig);
      this.render();
    });
  }

  private attachEvents(): void {
    if (!this.containerEl) return;

    // Academic plan settings
    this.containerEl.querySelector('#cursa-grades-open-plan-btn')?.addEventListener('click', () => {
      OnboardingModal.getInstance().open(true);
    });
    this.containerEl.querySelector('#cursa-grades-empty-term-config-btn')?.addEventListener('click', () => {
      OnboardingModal.getInstance().open(true);
    });

    // Subject & Overview tabs
    this.containerEl.querySelectorAll<HTMLElement>('.cursa-grade-subj-tab, .cursa-overview-card-btn').forEach((el) => {
      el.addEventListener('click', () => {
        const subj = el.getAttribute('data-subj');
        if (subj) this.setActiveSubject(subj);
      });
    });

    // AI Chat
    this.containerEl.querySelector('#cursa-grades-open-ai-chat')?.addEventListener('click', () => this.openAIChat());
    this.containerEl.querySelector('#cursa-reconfigure-ai-btn')?.addEventListener('click', () => this.openAIChat());

    // Templates
    this.containerEl.querySelector('#cursa-grades-use-template')?.addEventListener('click', () => {
      this.currentConfig = createInitialSubjectGrades(this.activeSubject);
      saveSubjectGrades(this.currentConfig);
      this.loadSubject(this.activeSubject);
    });
    this.containerEl.querySelector('#cursa-grades-start-blank')?.addEventListener('click', () => {
      this.currentConfig = {
        subjectName: this.activeSubject,
        credits: 6,
        items: [
          {
            id: `item_${Date.now()}_1`,
            name: 'Examen Final',
            type: 'EXAMEN',
            weight: 100,
            grade: null,
            category: 'Evaluación General'
          }
        ],
        updatedAt: Date.now()
      };
      saveSubjectGrades(this.currentConfig);
      this.loadSubject(this.activeSubject);
    });

    // Credits ECTS input
    const creditsInput = this.containerEl.querySelector('#cursa-credits-input') as HTMLInputElement | null;
    creditsInput?.addEventListener('change', () => {
      if (!this.currentConfig) return;
      const val = parseFloat(creditsInput.value);
      if (!isNaN(val) && val > 0) {
        this.currentConfig.credits = Math.min(30, Math.max(1, val));
        saveSubjectGrades(this.currentConfig);
      }
    });

    // Inline delete confirmation
    this.containerEl.querySelector('#cursa-delete-grades-btn')?.addEventListener('click', () => {
      this.pendingDeleteConfirm = !this.pendingDeleteConfirm;
      this.render();
    });
    this.containerEl.querySelector('#cursa-confirm-delete-cancel')?.addEventListener('click', () => {
      this.pendingDeleteConfirm = false;
      this.render();
    });
    this.containerEl.querySelector('#cursa-confirm-delete-yes')?.addEventListener('click', () => {
      deleteSubjectGrades(this.activeSubject);
      this.currentConfig = null;
      this.pendingDeleteConfirm = false;
      this.render();
    });

    // Add new Block
    this.containerEl.querySelector('#cursa-add-block-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      const existingGroups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
      const newBlockName = `Bloque ${existingGroups.length + 1}`;
      this.currentConfig.items.push({
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: 'Nueva evaluación',
        type: 'EXAMEN',
        weight: 0,
        grade: null,
        category: newBlockName
      });
      saveSubjectGrades(this.currentConfig);
      this.expandedGroups.add(newBlockName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      this.render();
    });

    // Add Item (global)
    this.containerEl.querySelector('#cursa-add-item-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
      const defaultCategory = groups.length > 0 ? groups[0].name : undefined;
      this.currentConfig.items.push({
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `Evaluación ${this.currentConfig.items.length + 1}`,
        type: 'EXAMEN',
        weight: 10,
        grade: null,
        category: defaultCategory !== 'Evaluación General' ? defaultCategory : undefined
      });
      saveSubjectGrades(this.currentConfig);
      this.render();
    });

    // Add Item to Group
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-add-to-group-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.currentConfig) return;
        const groupName = btn.getAttribute('data-group') || 'Evaluación General';
        this.currentConfig.items.push({
          id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: 'Nueva evaluación',
          category: groupName !== 'Evaluación General' ? groupName : undefined,
          type: 'EXAMEN',
          weight: 10,
          grade: null
        });
        saveSubjectGrades(this.currentConfig);
        this.expandedGroups.add(groupName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        this.render();
      });
    });

    // Add Subtopic to Group
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-add-subgroup-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.currentConfig) return;
        const groupName = btn.getAttribute('data-group') || 'Prácticas';
        const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
        const grp = groups.find((g) => g.name === groupName);
        const nextNum = (grp?.subgroups.filter((s) => Boolean(s.name)).length || 0) + 1;
        this.currentConfig.items.push({
          id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: 'Nueva entrega',
          category: groupName,
          subcategory: `Tema ${nextNum}`,
          type: 'ENTREGA',
          weight: 5,
          grade: null
        });
        saveSubjectGrades(this.currentConfig);
        this.expandedGroups.add(groupName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        this.render();
      });
    });

    // Add Item to Subgroup
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-add-to-subgroup-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.currentConfig) return;
        const group = btn.getAttribute('data-group') || 'Prácticas';
        const sub = btn.getAttribute('data-sub') || 'Tema 1';
        this.currentConfig.items.push({
          id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: 'Nueva evaluación',
          category: group,
          subcategory: sub,
          type: 'ENTREGA',
          weight: 5,
          grade: null
        });
        saveSubjectGrades(this.currentConfig);
        this.expandedGroups.add(group.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        this.render();
      });
    });

    // Toggle All Groups
    this.containerEl.querySelector('#cursa-toggle-all-groups-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
      const allExpanded = groups.length > 0 && groups.every((g) => this.expandedGroups.has(g.id));
      if (allExpanded) this.expandedGroups.clear();
      else groups.forEach((g) => this.expandedGroups.add(g.id));
      this.render();
    });

    // Accordion Header Toggle
    this.containerEl.querySelectorAll<HTMLElement>('.cursa-accordion-header').forEach((header) => {
      header.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('input') || target.closest('button') || target.closest('label')) return;
        const groupId = header.getAttribute('data-group-id');
        if (!groupId) return;
        if (this.expandedGroups.has(groupId)) this.expandedGroups.delete(groupId);
        else this.expandedGroups.add(groupId);
        this.render();
      });
    });

    // Rename Block
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-block-rename-input').forEach((inp) => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', () => {
        if (!this.currentConfig) return;
        const oldName = inp.getAttribute('data-old-group') || '';
        const newName = inp.value.trim();
        if (!newName || newName === oldName) {
          inp.value = oldName;
          return;
        }
        const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
        const grp = groups.find((g) => g.name === oldName);
        if (grp) {
          grp.items.forEach((w) => {
            if (this.currentConfig!.items[w.originalIndex]) {
              this.currentConfig!.items[w.originalIndex].category = newName;
            }
          });
        }
        if (this.currentConfig.blockCutoffs && oldName in this.currentConfig.blockCutoffs) {
          this.currentConfig.blockCutoffs[newName] = this.currentConfig.blockCutoffs[oldName];
          delete this.currentConfig.blockCutoffs[oldName];
        }
        this.expandedGroups.add(newName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        saveSubjectGrades(this.currentConfig);
        this.render();
      });
    });

    // Rename Subtopic
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-subtopic-rename-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (!this.currentConfig) return;
        const groupName = inp.getAttribute('data-group') || '';
        const oldSub = inp.getAttribute('data-old-sub') || '';
        const newSub = inp.value.trim();
        if (!newSub || newSub === oldSub) {
          inp.value = oldSub;
          return;
        }
        const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
        const grp = groups.find((g) => g.name === groupName);
        const sub = grp?.subgroups.find((s) => s.name === oldSub);
        if (sub) {
          sub.items.forEach((w) => {
            if (this.currentConfig!.items[w.originalIndex]) {
              this.currentConfig!.items[w.originalIndex].subcategory = newSub;
            }
          });
        }
        saveSubjectGrades(this.currentConfig);
        this.render();
      });
    });

    // Block Cutoff Inputs
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-block-cutoff-input').forEach((inp) => {
      inp.addEventListener('click', (e) => e.stopPropagation());
      inp.addEventListener('change', (e) => {
        e.stopPropagation();
        const groupName = inp.getAttribute('data-group');
        if (!groupName || !this.currentConfig) return;
        if (!this.currentConfig.blockCutoffs) this.currentConfig.blockCutoffs = {};
        const val = inp.value.trim() === '' ? undefined : parseFloat(inp.value);
        if (val !== undefined && !isNaN(val) && val > 0) {
          this.currentConfig.blockCutoffs[groupName] = Math.min(10, val);
        } else {
          delete this.currentConfig.blockCutoffs[groupName];
        }
        saveSubjectGrades(this.currentConfig);
        this.render();
      });
    });

    // Global Cutoff Input
    const cutoffInput = this.containerEl.querySelector('#cursa-cutoff-input') as HTMLInputElement | null;
    cutoffInput?.addEventListener('change', () => {
      if (!this.currentConfig) return;
      const val = cutoffInput.value.trim() === '' ? undefined : parseFloat(cutoffInput.value);
      this.currentConfig.minFinalGradeRequired = val && !isNaN(val) && val > 0 ? Math.min(10, val) : undefined;
      saveSubjectGrades(this.currentConfig);
      this.updateLiveMetricsInPlace();
    });

    // Item Type Pill (click cycles EXAMEN -> ENTREGA -> OTRO)
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-item-type-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        if (!this.currentConfig || !this.currentConfig.items[idx]) return;
        const current = this.currentConfig.items[idx].type;
        const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(current) + 1) % TYPE_CYCLE.length];
        this.currentConfig.items[idx].type = next;
        saveSubjectGrades(this.currentConfig);
        btn.className = `cg-type-pill ${next} cursa-item-type-pill`;
        btn.textContent = TYPE_LABELS[next];
      });
    });

    // Item Name Input
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-name-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        const group = inp.getAttribute('data-group');
        const sub = inp.getAttribute('data-sub');
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items[idx].name = inp.value.trim() || `Evaluación ${idx + 1}`;
          if (group && group !== 'Evaluación General') {
            this.currentConfig.items[idx].category = group;
          }
          if (sub) {
            this.currentConfig.items[idx].subcategory = sub;
          }
          saveSubjectGrades(this.currentConfig);
        }
      });
    });

    // Item Weight Input (surgical live update!)
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-weight-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        const val = parseFloat(inp.value);
        if (this.currentConfig && this.currentConfig.items[idx] && !isNaN(val)) {
          this.currentConfig.items[idx].weight = Math.max(0, Math.min(100, val));
          saveSubjectGrades(this.currentConfig);
          this.updateLiveMetricsInPlace();
        }
      });
    });

    // Item-level Cutoff Input (surgical live update!)
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-cutoff-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        if (!this.currentConfig || !this.currentConfig.items[idx]) return;
        const val = inp.value.trim() === '' ? undefined : parseFloat(inp.value);
        if (val !== undefined && !isNaN(val) && val > 0) {
          this.currentConfig.items[idx].minGradeRequired = Math.min(10, val);
          inp.classList.add('active');
        } else {
          this.currentConfig.items[idx].minGradeRequired = undefined;
          inp.classList.remove('active');
        }
        saveSubjectGrades(this.currentConfig);
        this.updateLiveMetricsInPlace();
      });
    });

    // Dual-Mode Grade / What-If Input (surgical live update, zero focus loss!)
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-grade-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        const itemId = inp.getAttribute('data-item-id') || '';
        const mode = inp.getAttribute('data-mode') || 'real';
        if (!this.currentConfig || !this.currentConfig.items[idx]) return;

        const raw = inp.value.trim();
        const parsed = raw === '' ? null : parseFloat(raw);
        const clamped = parsed !== null && !isNaN(parsed) ? Math.max(0, Math.min(10, parsed)) : null;

        if (mode === 'sim') {
          if (clamped !== null) {
            this.simulatedGrades[itemId] = clamped;
          } else {
            delete this.simulatedGrades[itemId];
          }
          inp.classList.toggle('simulated', true);
          this.updateLiveMetricsInPlace();
        } else {
          this.currentConfig.items[idx].grade = clamped;
          if (clamped !== null) {
            delete this.simulatedGrades[itemId];
            this.simInputModeIds.delete(itemId);
          }
          inp.classList.toggle('graded', clamped !== null);
          saveSubjectGrades(this.currentConfig);
          this.updateLiveMetricsInPlace();
        }
      });
    });

    // Toggle What-If Simulation Mode on Pending Item
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-sim-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id') || '';
        if (!itemId) return;
        if (this.simInputModeIds.has(itemId) || itemId in this.simulatedGrades) {
          this.simInputModeIds.delete(itemId);
          delete this.simulatedGrades[itemId];
        } else {
          this.simInputModeIds.add(itemId);
        }
        this.render();
        const nextInput = this.containerEl?.querySelector<HTMLInputElement>(`.cursa-item-grade-input[data-item-id="${CSS.escape(itemId)}"]`);
        nextInput?.focus();
      });
    });

    // Delete Item
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-del-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        if (this.currentConfig && this.currentConfig.items[idx]) {
          const removed = this.currentConfig.items[idx];
          delete this.simulatedGrades[removed.id];
          this.currentConfig.items.splice(idx, 1);
          saveSubjectGrades(this.currentConfig);
          this.render();
        }
      });
    });

    // Link / Unlink Calendar Event
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-link-cal-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        if (!this.currentConfig || !this.currentConfig.items[idx]) return;
        const item = this.currentConfig.items[idx];

        const overlay = document.getElementById('cursa-grades-view-overlay');
        if (overlay) overlay.style.display = 'none';

        CalendarPickerMode.getInstance().startSelection(
          this.activeSubject,
          item.name,
          (picked) => {
            if (this.currentConfig && this.currentConfig.items[idx]) {
              this.currentConfig.items[idx].linkedCalendarEventId = picked.eventId;
              this.currentConfig.items[idx].linkedEventTitle = picked.eventTitle;
              saveSubjectGrades(this.currentConfig);
            }
            if (overlay) overlay.style.display = 'flex';
            this.render();
          },
          () => {
            if (overlay) overlay.style.display = 'flex';
          }
        );
      });
    });

    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-unlink-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items[idx].linkedCalendarEventId = undefined;
          this.currentConfig.items[idx].linkedEventTitle = undefined;
          saveSubjectGrades(this.currentConfig);
          this.render();
        }
      });
    });

    this.bindTargetButtons();
    this.bindScenarioControls();
    this.bindNormalizeButton();
  }

  private openAIChat(): void {
    const credits = this.currentConfig?.credits || 6;
    GradesChatModal.getInstance().open(
      this.activeSubject,
      credits,
      (newConfig) => {
        this.currentConfig = newConfig;
        this.loadSubject(this.activeSubject);
      },
      this.currentConfig
    );
  }
}
