import { safeSetInnerHTML, escapeHtml } from '../../utils/dom';
import { SubjectGradesConfig, GradeItem, GradeItemType } from '../../../shared/gradesTypes';
import { getSubjectGrades, saveSubjectGrades, deleteSubjectGrades, createInitialSubjectGrades } from '../../services/gradesStorage';
import {
  calculateAccumulatedScore,
  calculateTargetRequiredGrade,
  calculateSimulatedFinalGrade,
  groupGradeItems,
  GradeGroup,
  GradeSubgroup,
  GradeGroupItem
} from '../../../shared/gradesCalculator';
import { GoogleCalendarAdapter } from '../../adapter/GoogleCalendarAdapter';
import { GradesChatModal } from './gradesChatModal';
import { CalendarPickerMode } from './calendarPickerMode';

export class GradesSimulatorView {
  private static instance: GradesSimulatorView | null = null;
  private containerEl: HTMLElement | null = null;
  private activeSubject: string = '';
  private currentConfig: SubjectGradesConfig | null = null;
  private currentTarget: number = 5.0;
  private simulatedScore: number = 5.0;
  private expandedGroups: Set<string> = new Set();

  public static getInstance(): GradesSimulatorView {
    if (!GradesSimulatorView.instance) {
      GradesSimulatorView.instance = new GradesSimulatorView();
    }
    return GradesSimulatorView.instance;
  }

  private constructor() {}

  public mount(parent: HTMLElement): void {
    this.containerEl = parent;
    const detectedClasses = GoogleCalendarAdapter.getInstance().getDetectedClasses();
    if (!this.activeSubject || !detectedClasses.includes(this.activeSubject)) {
      this.activeSubject = detectedClasses[0] || 'Asignatura 1';
    }
    this.loadSubject(this.activeSubject);
  }

  public setActiveSubject(subject: string): void {
    this.activeSubject = subject;
    this.loadSubject(subject);
  }

  private loadSubject(subject: string): void {
    this.currentConfig = getSubjectGrades(subject);
    this.expandedGroups.clear();
    if (this.currentConfig) {
      const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
      groups.forEach((g) => this.expandedGroups.add(g.id));
    }
    this.render();
  }

  public render(): void {
    if (!this.containerEl) return;

    const detectedClasses = GoogleCalendarAdapter.getInstance().getDetectedClasses();
    const adapter = GoogleCalendarAdapter.getInstance();
    const colorMap = adapter.getSubjectColorMap();

    safeSetInnerHTML(
      this.containerEl,
      `
      <div id="cursa-grades-view-root" style="
        width: 100%;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 20px 32px 64px 32px;
        box-sizing: border-box;
        font-family: 'Google Sans', 'Google Sans Text', Roboto, -apple-system, sans-serif;
        color: var(--gcal-text, #e8eaed);
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: var(--gcal-bg, var(--gcal-background, #1f1f1f));
        max-width: 1360px;
        margin: 0 auto;
      ">
        <!-- Top Subject Tabs (Google Workspace Material 3 Style) -->
        <div class="cursa-grades-tabs-scroll" style="
          display: flex;
          align-items: center;
          gap: 10px;
          overflow-x: auto;
          flex-shrink: 0;
          min-height: 44px;
          padding: 2px 0 6px 0;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        ">
          ${detectedClasses
            .map((subj) => {
              const isActive = subj === this.activeSubject;
              const subjColor = adapter.findSubjectColor(subj, colorMap);
              const config = getSubjectGrades(subj);
              const credits = config?.credits || 6;
              const isConfigured = !!config;

              return `
                <button type="button" class="cursa-grade-subj-tab" data-subj="${escapeHtml(subj)}" style="
                  height: 36px;
                  padding: 0 16px;
                  border-radius: 18px;
                  border: 1.5px solid ${isActive ? subjColor : 'var(--gcal-border, #444746)'};
                  background: ${isActive ? 'var(--gcal-surface-hover, #35373b)' : 'var(--gcal-surface, #282a2d)'};
                  color: ${isActive ? subjColor : 'var(--gcal-secondary-text, #9aa0a6)'};
                  font-family: 'Google Sans', Roboto, sans-serif;
                  font-weight: ${isActive ? '600' : '500'};
                  font-size: 13.5px;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  white-space: nowrap;
                  box-shadow: ${isActive ? '0 1px 4px rgba(0,0,0,0.25)' : 'none'};
                  transition: all 0.15s ease;
                " onmouseover="if(!this.dataset.active) { this.style.background='var(--gcal-surface-hover, #35373b)'; }" onmouseout="if(!this.dataset.active) { this.style.background='var(--gcal-surface, #282a2d)'; }" ${isActive ? 'data-active="true"' : ''}>
                  <span style="
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: ${subjColor};
                    display: inline-block;
                    flex-shrink: 0;
                  "></span>
                  <span>${escapeHtml(subj)}</span>
                  <span style="
                    font-size: 11px;
                    font-weight: 500;
                    color: ${isActive ? subjColor : 'var(--gcal-secondary-text, #9aa0a6)'};
                    background: ${isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'};
                    padding: 1px 6px;
                    border-radius: 4px;
                  ">${credits} ECTS</span>
                  ${isConfigured ? '<span style="font-size: 11px; color: #81c995;" title="Configurada">✓</span>' : ''}
                </button>
              `;
            })
            .join('')}
        </div>

        ${!this.currentConfig ? this.renderEmptyState() : this.renderSimulatorContent()}
      </div>
    `
    );

    this.attachEvents();
  }

  private renderEmptyState(): string {
    const adapter = GoogleCalendarAdapter.getInstance();
    const colorMap = adapter.getSubjectColorMap();
    const subjColor = adapter.findSubjectColor(this.activeSubject, colorMap);

    return `
      <div style="
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 64px 32px;
        background: var(--gcal-surface, #282a2d);
        border: 1px solid var(--gcal-border, #444746);
        border-radius: 24px;
        margin-top: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      ">
        <div style="
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(26, 115, 232, 0.2) 0%, rgba(155, 114, 203, 0.25) 100%);
          border: 1px solid rgba(138, 180, 248, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          margin-bottom: 20px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        ">
          ✨
        </div>
        <h2 style="
          margin: 0 0 10px 0;
          font-size: 22px;
          font-weight: 500;
          font-family: 'Google Sans', Roboto, sans-serif;
          color: var(--gcal-text, #e8eaed);
        ">
          Configura el Sistema de Evaluación de <span style="color: ${subjColor}; font-weight: 600;">${escapeHtml(this.activeSubject)}</span>
        </h2>
        <p style="
          margin: 0 0 28px 0;
          max-width: 540px;
          font-size: 14px;
          line-height: 1.6;
          color: var(--gcal-secondary-text, #9aa0a6);
        ">
          Define los exámenes, prácticas y ponderaciones para calcular automáticamente tus notas, objetivos y aportes. Puedes pegar directamente la guía docente o tu fórmula con nuestro <strong>Asistente Gemini</strong>.
        </p>
        <div style="display: flex; gap: 14px; flex-wrap: wrap; justify-content: center;">
          <button id="cursa-grades-open-ai-chat" type="button" style="
            background: linear-gradient(135deg, #1a73e8 0%, #4285f4 50%, #9b72cb 100%);
            color: #ffffff;
            border: none;
            padding: 11px 24px;
            border-radius: 20px;
            font-family: 'Google Sans', Roboto, sans-serif;
            font-weight: 500;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 10px;
            transition: opacity 0.2s ease, transform 0.1s ease;
          " onmouseover="this.style.opacity='0.9';" onmouseout="this.style.opacity='1';">
            <span style="font-size: 16px;">✨</span>
            <span>Configurar con Asistente Gemini</span>
          </button>
          <button id="cursa-grades-use-template" type="button" style="
            background: var(--gcal-surface-hover, #35373b);
            color: var(--gcal-text, #e8eaed);
            border: 1px solid var(--gcal-border, #444746);
            padding: 11px 22px;
            border-radius: 20px;
            font-family: 'Google Sans', Roboto, sans-serif;
            font-weight: 500;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.15s ease;
          " onmouseover="this.style.background='var(--gcal-selected, #004a77)';" onmouseout="this.style.background='var(--gcal-surface-hover, #35373b)';">
            Plantilla Estándar (Teoría 50% / Prácticas 50%)
          </button>
        </div>
      </div>
    `;
  }

  private renderSimulatorContent(): string {
    if (!this.currentConfig) return '';

    const config = this.currentConfig;
    const adapter = GoogleCalendarAdapter.getInstance();
    const colorMap = adapter.getSubjectColorMap();
    const subjColor = adapter.findSubjectColor(this.activeSubject, colorMap);

    const { accumulatedPoints, gradedWeight, totalWeight } = calculateAccumulatedScore(config.items);
    const isSum100 = totalWeight === 100;
    const targetCalc = calculateTargetRequiredGrade(config.items, this.currentTarget, config.minFinalGradeRequired);
    const simResult = calculateSimulatedFinalGrade(config.items, this.simulatedScore, config.minFinalGradeRequired, config.blockCutoffs);

    // Dynamic grouping into Generalist Material 3 Outliner Blocks (Estructura 6)
    const groups = groupGradeItems(config.items, config.blockCutoffs);
    if (this.expandedGroups.size === 0 && groups.length > 0) {
      groups.forEach((g) => this.expandedGroups.add(g.id));
    }
    const allExpanded = groups.length > 0 && groups.every((g) => this.expandedGroups.has(g.id));

    // Color logic for target calculation card
    let targetStatusColor = '#81c995';
    let targetStatusBg = 'rgba(129, 201, 149, 0.15)';
    let targetStatusBorder = 'rgba(129, 201, 149, 0.3)';
    let targetStatusLabel = 'Factible (≤ 6.5)';
    if (!targetCalc.isPossible) {
      targetStatusColor = '#f28b82';
      targetStatusBg = 'rgba(242, 139, 130, 0.15)';
      targetStatusBorder = 'rgba(242, 139, 130, 0.3)';
      targetStatusLabel = 'Inalcanzable (> 10.0)';
    } else if (targetCalc.requiredFinalGrade > 8.5) {
      targetStatusColor = '#fdd663';
      targetStatusBg = 'rgba(253, 214, 99, 0.15)';
      targetStatusBorder = 'rgba(253, 214, 99, 0.3)';
      targetStatusLabel = 'Muy exigente (8.5 - 10)';
    } else if (targetCalc.requiredFinalGrade > 6.5) {
      targetStatusColor = '#8ab4f8';
      targetStatusBg = 'rgba(138, 180, 248, 0.15)';
      targetStatusBorder = 'rgba(138, 180, 248, 0.3)';
      targetStatusLabel = 'Exigente (6.5 - 8.5)';
    }

    // Color logic for simulated score card
    let simStatusColor = '#81c995';
    let simStatusBg = 'rgba(129, 201, 149, 0.15)';
    let simStatusBorder = 'rgba(129, 201, 149, 0.3)';
    let simStatusLabel = 'Aprobado';
    if (simResult.isCutoffFailed) {
      simStatusColor = '#f28b82';
      simStatusBg = 'rgba(242, 139, 130, 0.15)';
      simStatusBorder = 'rgba(242, 139, 130, 0.3)';
      simStatusLabel = simResult.failedBlockCutoff
        ? `Corte no superado: ${simResult.failedBlockCutoff}`
        : `Corte no superado (< ${simResult.minCutoff?.toFixed(2)})`;
    } else if (simResult.finalGrade >= 9.0) {
      simStatusColor = '#81c995';
      simStatusBg = 'rgba(129, 201, 149, 0.15)';
      simStatusBorder = 'rgba(129, 201, 149, 0.3)';
      simStatusLabel = 'Sobresaliente';
    } else if (simResult.finalGrade >= 7.0) {
      simStatusColor = '#8ab4f8';
      simStatusBg = 'rgba(138, 180, 248, 0.15)';
      simStatusBorder = 'rgba(138, 180, 248, 0.3)';
      simStatusLabel = 'Notable';
    } else if (simResult.finalGrade >= 5.0) {
      simStatusColor = '#81c995';
      simStatusBg = 'rgba(129, 201, 149, 0.15)';
      simStatusBorder = 'rgba(129, 201, 149, 0.3)';
      simStatusLabel = 'Aprobado';
    } else {
      simStatusColor = '#f28b82';
      simStatusBg = 'rgba(242, 139, 130, 0.15)';
      simStatusBorder = 'rgba(242, 139, 130, 0.3)';
      simStatusLabel = 'Suspenso (< 5.0)';
    }

    return `
      <!-- Subject Header Bar (Sleek Notion/Raycast Studio Style) -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--gcal-surface, #282a2d);
        padding: 16px 22px;
        border-radius: 16px;
        border: 1px solid var(--gcal-border, #444746);
        box-shadow: 0 1px 4px rgba(0,0,0,0.18);
      ">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="
            width: 44px;
            height: 44px;
            border-radius: 12px;
            background: ${subjColor}1a;
            border: 1.5px solid ${subjColor};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            color: ${subjColor};
          ">
            📚
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h1 style="
                margin: 0;
                font-size: 21px;
                font-weight: 600;
                font-family: 'Google Sans', Roboto, sans-serif;
                color: var(--gcal-text, #e8eaed);
              ">
                ${escapeHtml(config.subjectName)}
              </h1>
              <span style="
                font-size: 12px;
                background: var(--gcal-surface-hover, #35373b);
                color: var(--gcal-secondary-text, #9aa0a6);
                border: 1px solid var(--gcal-border, #444746);
                font-weight: 500;
                padding: 2px 10px;
                border-radius: 12px;
              ">
                ${config.credits} ECTS
              </span>
              ${
                accumulatedPoints >= 5.0
                  ? `<span style="
                      font-size: 12px;
                      background: rgba(129, 201, 149, 0.15);
                      color: #81c995;
                      border: 1px solid rgba(129, 201, 149, 0.3);
                      font-weight: 600;
                      padding: 2px 10px;
                      border-radius: 12px;
                    ">
                      🎉 Aprobado Asegurado
                    </span>`
                  : `<span style="
                      font-size: 12px;
                      background: rgba(138, 180, 248, 0.12);
                      color: var(--gcal-accent, #8ab4f8);
                      border: 1px solid rgba(138, 180, 248, 0.25);
                      font-weight: 500;
                      padding: 2px 10px;
                      border-radius: 12px;
                    ">
                      Faltan ${(5.0 - accumulatedPoints).toFixed(2)} pts para 5.0
                    </span>`
              }
            </div>
            <div style="font-size: 13px; color: var(--gcal-secondary-text, #9aa0a6); margin-top: 3px;">
              Puntuación asegurada: <strong style="color: var(--gcal-accent, #8ab4f8); font-weight: 600;">${accumulatedPoints.toFixed(2)} pts</strong> de 10 • ${gradedWeight}% evaluado del curso
            </div>
          </div>
        </div>

        <!-- Action Toolbar -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="cursa-add-item-btn" type="button" style="
            background: var(--gcal-surface-hover, #35373b);
            color: var(--gcal-accent, #8ab4f8);
            border: 1px solid var(--gcal-border, #444746);
            padding: 8px 16px;
            border-radius: 18px;
            font-size: 13px;
            font-weight: 500;
            font-family: 'Google Sans', Roboto, sans-serif;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
          " onmouseover="this.style.background='var(--gcal-selected, #004a77)';" onmouseout="this.style.background='var(--gcal-surface-hover, #35373b)';">
            <span style="font-size: 15px; font-weight: 700;">+</span>
            <span>Añadir Hito</span>
          </button>

          <button id="cursa-reconfigure-ai-btn" type="button" style="
            background: linear-gradient(135deg, #1a73e8 0%, #4285f4 50%, #9b72cb 100%);
            color: #ffffff;
            border: none;
            padding: 8px 18px;
            border-radius: 18px;
            font-size: 13px;
            font-weight: 500;
            font-family: 'Google Sans', Roboto, sans-serif;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.25);
            transition: opacity 0.15s ease;
          " onmouseover="this.style.opacity='0.9';" onmouseout="this.style.opacity='1';">
            <span>✨</span>
            <span>Asistente Gemini</span>
          </button>

          <button id="cursa-delete-grades-btn" type="button" style="
            background: transparent;
            color: var(--gcal-secondary-text, #9aa0a6);
            border: 1px solid transparent;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
          " onmouseover="this.style.background='rgba(242, 139, 130, 0.15)'; this.style.color='#f28b82';" onmouseout="this.style.background='transparent'; this.style.color='var(--gcal-secondary-text, #9aa0a6)';" title="Borrar datos de esta materia">
            🗑️
          </button>
        </div>
      </div>

      <!-- Integrated HUD Summary Strip (Progreso + Objetivo + Simulador) -->
      <div style="
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
      ">
        <!-- HUD 1: Progreso Actual y Nota Acumulada -->
        <div style="
          background: var(--gcal-surface, #282a2d);
          border: 1px solid var(--gcal-border, #444746);
          border-radius: 16px;
          padding: 16px 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.18);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        ">
          <div>
            <div style="
              font-size: 11px;
              font-weight: 600;
              letter-spacing: 0.8px;
              text-transform: uppercase;
              color: var(--gcal-secondary-text, #9aa0a6);
              display: flex;
              align-items: center;
              gap: 6px;
            ">
              <span>📊</span> <span>Progreso Global</span>
            </div>
            <div style="
              font-size: 32px;
              font-weight: 500;
              font-family: 'Google Sans', Roboto, sans-serif;
              color: var(--gcal-accent, #8ab4f8);
              line-height: 1.15;
              margin: 6px 0 2px 0;
            ">
              ${accumulatedPoints.toFixed(2)}
              <span style="font-size: 14px; font-weight: 400; color: var(--gcal-secondary-text, #9aa0a6);">/ 10 pts</span>
            </div>
            <div style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">
              Puntos asegurados (${gradedWeight}% evaluado)
            </div>
          </div>

          <div style="margin-top: 12px;">
            <div style="
              width: 100%;
              height: 6px;
              background: var(--gcal-surface-hover, #35373b);
              border-radius: 3px;
              overflow: hidden;
              position: relative;
            ">
              <div style="
                width: ${Math.min(100, (accumulatedPoints / 10) * 100)}%;
                height: 100%;
                background: ${accumulatedPoints >= 5.0 ? '#81c995' : 'var(--gcal-accent, #8ab4f8)'};
                border-radius: 3px;
                transition: width 0.3s ease;
              "></div>
              <div style="
                position: absolute;
                left: 50%;
                top: 0;
                width: 2px;
                height: 100%;
                background: rgba(255,255,255,0.3);
              " title="Corte de Aprobado (5.0)"></div>
            </div>

            <div style="
              margin-top: 8px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              font-size: 11.5px;
            ">
              ${
                accumulatedPoints >= 5.0
                  ? `<span style="background: rgba(129, 201, 149, 0.15); color: #81c995; border: 1px solid rgba(129, 201, 149, 0.3); font-weight: 600; padding: 1px 8px; border-radius: 8px;">
                      🎉 ¡Aprobado asegurado!
                    </span>`
                  : `<span style="color: var(--gcal-secondary-text, #9aa0a6);">
                      Faltan <strong style="color: var(--gcal-text, #e8eaed);">${(5.0 - accumulatedPoints).toFixed(2)} pts</strong> para el 5.0
                    </span>`
              }
              <span style="color: var(--gcal-secondary-text, #9aa0a6); font-size: 11px;">Meta: 5.0 min</span>
            </div>
          </div>
        </div>

        <!-- HUD 2: Calculadora de Objetivo ("¿Qué necesito sacar?") -->
        <div style="
          background: var(--gcal-surface, #282a2d);
          border: 1px solid var(--gcal-border, #444746);
          border-radius: 16px;
          padding: 16px 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.18);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        ">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.8px;
                text-transform: uppercase;
                color: var(--gcal-secondary-text, #9aa0a6);
                display: flex;
                align-items: center;
                gap: 6px;
              ">
                <span>🎯</span> <span>Objetivo de Nota</span>
              </div>

              <!-- Quick Target Pills -->
              <div style="display: flex; gap: 5px;">
                <button type="button" class="cursa-target-btn ${this.currentTarget === 5.0 ? 'active' : ''}" data-target="5.0" style="
                  padding: 2px 8px;
                  border-radius: 10px;
                  border: 1px solid ${this.currentTarget === 5.0 ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-border, #444746)'};
                  background: ${this.currentTarget === 5.0 ? 'rgba(138, 180, 248, 0.18)' : 'transparent'};
                  color: ${this.currentTarget === 5.0 ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-secondary-text, #9aa0a6)'};
                  font-weight: 600;
                  font-size: 11px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                ">5.0</button>
                <button type="button" class="cursa-target-btn ${this.currentTarget === 7.0 ? 'active' : ''}" data-target="7.0" style="
                  padding: 2px 8px;
                  border-radius: 10px;
                  border: 1px solid ${this.currentTarget === 7.0 ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-border, #444746)'};
                  background: ${this.currentTarget === 7.0 ? 'rgba(138, 180, 248, 0.18)' : 'transparent'};
                  color: ${this.currentTarget === 7.0 ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-secondary-text, #9aa0a6)'};
                  font-weight: 600;
                  font-size: 11px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                ">7.0</button>
                <button type="button" class="cursa-target-btn ${this.currentTarget === 9.0 ? 'active' : ''}" data-target="9.0" style="
                  padding: 2px 8px;
                  border-radius: 10px;
                  border: 1px solid ${this.currentTarget === 9.0 ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-border, #444746)'};
                  background: ${this.currentTarget === 9.0 ? 'rgba(138, 180, 248, 0.18)' : 'transparent'};
                  color: ${this.currentTarget === 9.0 ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-secondary-text, #9aa0a6)'};
                  font-weight: 600;
                  font-size: 11px;
                  cursor: pointer;
                  transition: all 0.15s ease;
                ">9.0</button>
              </div>
            </div>

            <div style="
              font-size: ${targetCalc.isPossible ? '32px' : '22px'};
              font-weight: 500;
              font-family: 'Google Sans', Roboto, sans-serif;
              color: ${targetStatusColor};
              line-height: 1.15;
              margin: 6px 0 2px 0;
            ">
              ${targetCalc.isPossible ? targetCalc.requiredFinalGrade.toFixed(2) : 'Inalcanzable'}
              ${targetCalc.isPossible ? '<span style="font-size: 13px; font-weight: 400; color: var(--gcal-secondary-text, #9aa0a6);">en pendientes</span>' : ''}
            </div>

            <div style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">
              Para obtener un <strong style="color: var(--gcal-text, #e8eaed);">${this.currentTarget.toFixed(1)}</strong> final
            </div>
          </div>

          <div style="margin-top: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="
                background: ${targetStatusBg};
                color: ${targetStatusColor};
                border: 1px solid ${targetStatusBorder};
                font-weight: 600;
                font-size: 11px;
                padding: 2px 8px;
                border-radius: 8px;
                display: inline-block;
              ">
                ${targetStatusLabel}
              </span>

              ${
                targetCalc.isCutoffTriggered
                  ? `<span style="font-size: 11px; color: #fdd663; font-weight: 500;">
                      🛡️ Corte de ${targetCalc.minCutoff?.toFixed(2)}
                    </span>`
                  : ''
              }
            </div>
          </div>
        </div>

        <!-- HUD 3: Simulador de Escenario en Tiempo Real -->
        <div style="
          background: var(--gcal-surface, #282a2d);
          border: 1px solid var(--gcal-border, #444746);
          border-radius: 16px;
          padding: 16px 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.18);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        ">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.8px;
                text-transform: uppercase;
                color: var(--gcal-secondary-text, #9aa0a6);
                display: flex;
                align-items: center;
                gap: 6px;
              ">
                <span>🎚️</span> <span>Simulador de Escenario</span>
              </div>
              <span style="
                background: ${simStatusBg};
                color: ${simStatusColor};
                border: 1px solid ${simStatusBorder};
                font-weight: 600;
                font-size: 11px;
                padding: 1px 8px;
                border-radius: 8px;
              ">${simStatusLabel}</span>
            </div>

            <div style="
              font-size: 32px;
              font-weight: 500;
              font-family: 'Google Sans', Roboto, sans-serif;
              color: ${simStatusColor};
              line-height: 1.15;
              margin: 6px 0 2px 0;
            ">
              ${simResult.finalGrade.toFixed(2)}
              <span style="font-size: 13px; font-weight: 400; color: var(--gcal-secondary-text, #9aa0a6);">Nota Final Estimada</span>
            </div>

            <div style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">
              Si en el resto obtienes: <strong style="color: var(--gcal-accent, #8ab4f8);">${this.simulatedScore.toFixed(1)}</strong>
            </div>
          </div>

          <div style="margin-top: 10px;">
            <input id="cursa-sim-slider" type="range" min="0" max="10" step="0.1" value="${this.simulatedScore}" style="
              width: 100%;
              height: 5px;
              border-radius: 3px;
              accent-color: var(--gcal-accent, #8ab4f8);
              cursor: pointer;
            " />
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--gcal-secondary-text, #9aa0a6); margin-top: 2px;">
              <span>0.0</span>
              <span>5.0</span>
              <span>10.0</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Outliner Control Bar (Estructura 6 Notion/Things Tree Header) -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 6px;
        margin-top: 4px;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="
            font-family: 'Google Sans', Roboto, sans-serif;
            font-weight: 600;
            font-size: 15px;
            color: var(--gcal-text, #e8eaed);
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <span>🌲</span>
            <span>Árbol de Evaluación por Bloques y Temas</span>
          </span>
          <span style="
            font-size: 12px;
            background: var(--gcal-surface-hover, #35373b);
            color: var(--gcal-secondary-text, #9aa0a6);
            border: 1px solid var(--gcal-border, #444746);
            padding: 2px 10px;
            border-radius: 12px;
            font-weight: 500;
          ">
            ${groups.length} ${groups.length === 1 ? 'bloque' : 'bloques'} • ${config.items.length} hitos
          </span>
        </div>

        <div style="display: flex; align-items: center; gap: 14px;">
          <!-- Cutoff Setting -->
          <div style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--gcal-secondary-text, #9aa0a6);">
            <span>🛡️ Corte examen final:</span>
            <input id="cursa-cutoff-input" type="number" step="0.25" min="0" max="10" placeholder="Sin corte" value="${config.minFinalGradeRequired || ''}" style="
              width: 76px;
              padding: 4px 8px;
              border-radius: 8px;
              border: 1px solid var(--gcal-border, #444746);
              background: var(--gcal-surface, #282a2d);
              color: var(--gcal-text, #e8eaed);
              font-size: 12.5px;
              font-weight: 600;
              text-align: center;
              outline: none;
              transition: border-color 0.15s ease;
            " onfocus="this.style.borderColor='var(--gcal-accent, #8ab4f8)';" onblur="this.style.borderColor='var(--gcal-border, #444746)';" />
          </div>

          <!-- Expand / Collapse All Accordions -->
          <button id="cursa-toggle-all-groups-btn" type="button" style="
            background: var(--gcal-surface, #282a2d);
            border: 1px solid var(--gcal-border, #444746);
            color: var(--gcal-secondary-text, #9aa0a6);
            padding: 5px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            font-family: 'Google Sans', Roboto, sans-serif;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
          " onmouseover="this.style.background='var(--gcal-surface-hover, #35373b)'; this.style.color='var(--gcal-text, #e8eaed)';" onmouseout="this.style.background='var(--gcal-surface, #282a2d)'; this.style.color='var(--gcal-secondary-text, #9aa0a6)';">
            <span>${allExpanded ? '▶' : '▼'}</span>
            <span>${allExpanded ? 'Contraer todos' : 'Desplegar todos'}</span>
          </button>
        </div>
      </div>

      <!-- Outliner Blocks Stack (Option 6 Nested Outliner) -->
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${groups.map((group) => this.renderOutlinerBlock(group)).join('')}
      </div>

      <!-- Global Weight Summary Footer -->
      <div style="
        background: var(--gcal-surface, #282a2d);
        border: 1px solid var(--gcal-border, #444746);
        border-radius: 14px;
        padding: 14px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12.5px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.18);
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-weight: 500; color: var(--gcal-text, #e8eaed);">Ponderación Global Total:</span>
          <span style="
            font-weight: 700;
            font-family: 'Google Sans', Roboto, sans-serif;
            color: ${isSum100 ? '#81c995' : '#fdd663'};
          ">${totalWeight}%</span>
          <span style="
            background: ${isSum100 ? 'rgba(129, 201, 149, 0.15)' : 'rgba(253, 214, 99, 0.15)'};
            color: ${isSum100 ? '#81c995' : '#fdd663'};
            border: 1px solid ${isSum100 ? 'rgba(129, 201, 149, 0.3)' : 'rgba(253, 214, 99, 0.3)'};
            padding: 2px 8px;
            border-radius: 8px;
            font-size: 11.5px;
            font-weight: 500;
          ">
            ${isSum100 ? '✓ Ponderación equilibrada al 100%' : `⚠️ Falta asignar ${(100 - totalWeight).toFixed(1)}%`}
          </span>
        </div>

        <div style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">
          ${config.items.length} evaluaciones registradas en ${groups.length} bloques
        </div>
      </div>
    `;
  }

  private renderOutlinerBlock(group: GradeGroup): string {
    const isExpanded = this.expandedGroups.has(group.id);
    const hasSubgroups = group.subgroups.length > 1 || (group.subgroups.length === 1 && Boolean(group.subgroups[0].name));

    // Determine Group Semantic Icon
    let groupIcon = '📁';
    const lowerName = group.name.toLowerCase();
    if (lowerName.includes('teor') || lowerName.includes('theory')) groupIcon = '📘';
    else if (lowerName.includes('práct') || lowerName.includes('pract') || lowerName.includes('lab')) groupIcon = '🔬';
    else if (lowerName.includes('proy') || lowerName.includes('trabaj')) groupIcon = '🚀';
    else if (lowerName.includes('exam') || lowerName.includes('parcial')) groupIcon = '📋';

    return `
      <div class="cursa-outliner-block" data-group-id="${group.id}" style="
        background: var(--gcal-surface, #282a2d);
        border: 1px solid ${isExpanded ? 'var(--gcal-border, #444746)' : 'rgba(255,255,255,0.06)'};
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 1px 4px rgba(0,0,0,0.18);
        transition: border-color 0.2s ease;
      ">
        <!-- Outliner Block Header Bar -->
        <div class="cursa-accordion-header" data-group-id="${group.id}" style="
          padding: 14px 20px;
          background: ${isExpanded ? 'var(--gcal-surface-hover, #35373b)' : 'var(--gcal-surface, #282a2d)'};
          border-bottom: ${isExpanded ? '1px solid var(--gcal-border, #444746)' : 'none'};
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          user-select: none;
          transition: background 0.15s ease;
        " onmouseover="this.style.background='var(--gcal-surface-hover, #35373b)';" onmouseout="this.style.background='${isExpanded ? 'var(--gcal-surface-hover, #35373b)' : 'var(--gcal-surface, #282a2d)'}';">
          
          <!-- Left side: Chevron, Icon, Title, Weight Badge -->
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="
              font-size: 12px;
              color: var(--gcal-secondary-text, #9aa0a6);
              display: inline-block;
              transition: transform 0.2s ease;
              transform: ${isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'};
            ">▼</span>

            <span style="font-size: 20px;">${groupIcon}</span>

            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="
                  font-family: 'Google Sans', Roboto, sans-serif;
                  font-weight: 600;
                  font-size: 15.5px;
                  color: var(--gcal-text, #e8eaed);
                ">
                  ${escapeHtml(group.name)}
                </span>
                <span style="
                  font-size: 11.5px;
                  font-weight: 600;
                  background: rgba(138, 180, 248, 0.12);
                  color: var(--gcal-accent, #8ab4f8);
                  border: 1px solid rgba(138, 180, 248, 0.25);
                  padding: 2px 8px;
                  border-radius: 10px;
                ">
                  ${group.totalWeight}% de la Asignatura
                </span>
                <span style="
                  font-size: 11.5px;
                  color: var(--gcal-secondary-text, #9aa0a6);
                ">
                  ${hasSubgroups ? `${group.subgroups.length} temas • ` : ''}${group.items.length} ${group.items.length === 1 ? 'hito' : 'hitos'}
                </span>
              </div>
            </div>
          </div>

          <!-- Right side: Block Cutoff, Internal Score, Contribution, and Add Button -->
          <div style="display: flex; align-items: center; gap: 14px;">
            <!-- Independent Block Cutoff input -->
            <div style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--gcal-secondary-text, #9aa0a6);" title="Nota mínima de corte en este bloque para hacer media">
              <span>🛡️ Corte bloque:</span>
              <input type="number" step="0.25" min="0" max="10" placeholder="Sin corte" class="cursa-block-cutoff-input" data-group="${escapeHtml(group.name)}" value="${group.minGradeRequired || ''}" style="
                width: 58px;
                padding: 3px 6px;
                border-radius: 8px;
                border: 1px solid var(--gcal-border, #444746);
                background: var(--gcal-surface, #282a2d);
                color: var(--gcal-text, #e8eaed);
                font-size: 11.5px;
                font-weight: 600;
                text-align: center;
                outline: none;
              " onfocus="this.style.borderColor='var(--gcal-accent, #8ab4f8)';" onblur="this.style.borderColor='var(--gcal-border, #444746)';" />
            </div>

            ${
              group.gradedWeight > 0
                ? `
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #9aa0a6);">
                      Media Bloque:
                    </span>
                    <strong style="
                      font-size: 15px;
                      font-weight: 600;
                      font-family: 'Google Sans', Roboto, sans-serif;
                      color: ${group.blockScore >= (group.minGradeRequired ?? 5.0) ? '#81c995' : 'var(--gcal-accent, #8ab4f8)'};
                    ">
                      ${group.blockScore.toFixed(2)}
                    </strong>
                    <span style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">/ 10</span>
                    <span style="
                      font-size: 11.5px;
                      font-weight: 600;
                      color: #81c995;
                      background: rgba(129, 201, 149, 0.12);
                      border: 1px solid rgba(129, 201, 149, 0.25);
                      padding: 2px 8px;
                      border-radius: 8px;
                    ">
                      +${group.accumulatedPoints.toFixed(2)} pts global
                    </span>
                    ${
                      typeof group.minGradeRequired === 'number'
                        ? group.isCutoffMet
                          ? `<span style="font-size: 11px; color: #81c995; background: rgba(129, 201, 149, 0.15); border: 1px solid rgba(129, 201, 149, 0.3); padding: 2px 8px; border-radius: 8px; font-weight: 600;">✓ Corte superado (${group.blockScore.toFixed(2)} ≥ ${group.minGradeRequired.toFixed(1)})</span>`
                          : group.isCutoffImpossible
                          ? `<span style="font-size: 11px; color: #f28b82; background: rgba(242, 139, 130, 0.15); border: 1px solid rgba(242, 139, 130, 0.3); padding: 2px 8px; border-radius: 8px; font-weight: 600;">❌ Corte no alcanzable</span>`
                          : `<span style="font-size: 11px; color: #fdd663; background: rgba(253, 214, 99, 0.15); border: 1px solid rgba(253, 214, 99, 0.3); padding: 2px 8px; border-radius: 8px; font-weight: 600;">⚠️ Faltan ${group.missingBlockPoints?.toFixed(2)} pts</span>`
                        : ''
                    }
                  </div>
                `
                : `
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6); font-style: italic;">
                      Pendiente de evaluar
                    </span>
                    ${
                      typeof group.minGradeRequired === 'number'
                        ? `<span style="font-size: 11px; color: #fdd663; background: rgba(253, 214, 99, 0.12); border: 1px solid rgba(253, 214, 99, 0.25); padding: 2px 8px; border-radius: 8px; font-weight: 500;">Mín. ${group.minGradeRequired.toFixed(1)} requerido</span>`
                        : ''
                    }
                  </div>
                `
            }

            <button type="button" class="cursa-add-to-group-btn" data-group="${escapeHtml(group.name)}" style="
              background: var(--gcal-surface, #282a2d);
              color: var(--gcal-accent, #8ab4f8);
              border: 1px solid var(--gcal-border, #444746);
              padding: 4px 12px;
              border-radius: 14px;
              font-size: 11.5px;
              font-weight: 500;
              font-family: 'Google Sans', Roboto, sans-serif;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 4px;
              transition: all 0.15s ease;
            " onmouseover="this.style.background='var(--gcal-selected, #004a77)';" onmouseout="this.style.background='var(--gcal-surface, #282a2d)';">
              <span style="font-weight: 700;">+</span>
              <span>Añadir Hito</span>
            </button>
          </div>
        </div>

        <!-- Outliner Block Body (Option 6 Nested Trees) -->
        ${
          isExpanded
            ? `
              <div style="
                background: var(--gcal-surface, #282a2d);
                padding: 12px 18px 16px 18px;
                display: flex;
                flex-direction: column;
                gap: 8px;
              ">
                ${
                  hasSubgroups
                    ? group.subgroups
                        .map((sub) => {
                          const relInGroup =
                            group.totalWeight > 0 ? Math.round((sub.totalWeight / group.totalWeight) * 1000) / 10 : 0;

                          return `
                            <!-- Topic Branch Container (Tree Node) -->
                            <div class="cursa-topic-branch" style="
                              margin: 4px 0 8px 6px;
                              border-left: 2px solid rgba(138, 180, 248, 0.35);
                              padding-left: 14px;
                              display: flex;
                              flex-direction: column;
                              gap: 6px;
                            ">
                              <!-- Topic Header Bar -->
                              <div style="
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                                padding: 6px 12px;
                                background: rgba(255, 255, 255, 0.025);
                                border-radius: 8px;
                                margin-bottom: 4px;
                              ">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                  <span style="font-size: 13px;">📁</span>
                                  <strong style="
                                    font-size: 13.5px;
                                    font-weight: 600;
                                    font-family: 'Google Sans', Roboto, sans-serif;
                                    color: var(--gcal-text, #e8eaed);
                                  ">
                                    ${escapeHtml(sub.name || 'General')}
                                  </strong>
                                  <span style="
                                    font-size: 11px;
                                    font-weight: 600;
                                    background: rgba(138, 180, 248, 0.12);
                                    color: var(--gcal-accent, #8ab4f8);
                                    border: 1px solid rgba(138, 180, 248, 0.25);
                                    padding: 1px 7px;
                                    border-radius: 6px;
                                  ">
                                    ${sub.totalWeight}% global (${relInGroup}% de ${escapeHtml(group.name)})
                                  </span>
                                </div>

                                <div style="display: flex; align-items: center; gap: 10px;">
                                  ${
                                    sub.gradedWeight > 0
                                      ? `<span style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">
                                          Media tema: <strong style="color: ${sub.internalScore! >= 5.0 ? '#81c995' : 'var(--gcal-accent, #8ab4f8)'}; font-size: 13px;">${sub.internalScore?.toFixed(2)}</strong> / 10
                                          <span style="color: #81c995; font-weight: 600; margin-left: 4px;">(+${sub.accumulatedPoints.toFixed(2)} pts)</span>
                                        </span>`
                                      : `<span style="font-size: 11.5px; color: var(--gcal-secondary-text, #9aa0a6); font-style: italic;">Pendiente</span>`
                                  }
                                  <button type="button" class="cursa-add-to-subgroup-btn" data-group="${escapeHtml(group.name)}" data-sub="${escapeHtml(sub.name)}" style="
                                    background: transparent;
                                    border: 1px solid var(--gcal-border, #444746);
                                    color: var(--gcal-secondary-text, #9aa0a6);
                                    padding: 2px 10px;
                                    border-radius: 12px;
                                    font-size: 11px;
                                    cursor: pointer;
                                    transition: all 0.15s ease;
                                  " onmouseover="this.style.background='var(--gcal-surface-hover, #35373b)'; this.style.color='var(--gcal-accent, #8ab4f8)';" onmouseout="this.style.background='transparent'; this.style.color='var(--gcal-secondary-text, #9aa0a6)';">+ Añadir a ${escapeHtml(sub.name || 'este tema')}</button>
                                </div>
                              </div>

                              <!-- Nested Items for this topic -->
                              ${sub.items.map((itemWrap) => this.renderOutlinerRow(itemWrap, group, sub)).join('')}
                            </div>
                          `;
                        })
                        .join('')
                    : group.items.map((itemWrap) => this.renderOutlinerRow(itemWrap, group)).join('')
                }

                <!-- Outliner Block Footer (Subtotal) -->
                <div style="
                  margin-top: 6px;
                  padding: 10px 14px;
                  background: rgba(255, 255, 255, 0.015);
                  border-top: 1px solid var(--gcal-border, #444746);
                  border-radius: 0 0 12px 12px;
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  font-size: 12px;
                  color: var(--gcal-secondary-text, #9aa0a6);
                ">
                  <div>
                    Subtotal ${escapeHtml(group.name)}: <strong style="color: var(--gcal-text, #e8eaed);">${group.totalWeight}% ponderación</strong> • ${group.gradedWeight}% evaluado ${group.internalScore !== null ? `(media parcial: <strong style="color: var(--gcal-text, #e8eaed);">${group.internalScore.toFixed(2)} / 10</strong>)` : ''}
                  </div>
                  <div>
                    Aporte a la nota final: <strong style="color: #81c995; font-size: 13px;">+${group.accumulatedPoints.toFixed(2)} pts</strong>
                  </div>
                </div>
              </div>
            `
            : ''
        }
      </div>
    `;
  }

  private renderOutlinerRow(itemWrap: GradeGroupItem, group: GradeGroup, sub?: GradeSubgroup): string {
    const { item, originalIndex, displayName } = itemWrap;
    const hasGrade = typeof item.grade === 'number' && !isNaN(item.grade);
    const contrib = hasGrade ? ((item.grade! * item.weight) / 100).toFixed(2) : '—';

    // Relative weight calculations
    const relInGroup = group.totalWeight > 0 ? Math.round((item.weight / group.totalWeight) * 1000) / 10 : 0;
    const relInSub = sub && sub.totalWeight > 0 ? Math.round((item.weight / sub.totalWeight) * 1000) / 10 : 0;

    return `
      <div class="cursa-outliner-row" data-idx="${originalIndex}" style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        transition: all 0.15s ease;
      " onmouseover="this.style.background='var(--gcal-surface-hover, #35373b)'; this.style.borderColor='rgba(138, 180, 248, 0.3)';" onmouseout="this.style.background='rgba(255, 255, 255, 0.02)'; this.style.borderColor='rgba(255, 255, 255, 0.05)';">

        <!-- Left side: Type Selector, Name Input, Google Calendar Link -->
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
          <!-- Type Selector -->
          <select class="cursa-item-type-select" data-idx="${originalIndex}" style="
            padding: 3px 6px;
            border-radius: 8px;
            border: 1px solid var(--gcal-border, #444746);
            background: var(--gcal-surface, #282a2d);
            color: ${item.type === 'EXAMEN' ? '#8ab4f8' : item.type === 'ENTREGA' ? '#81c995' : '#fdd663'};
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            outline: none;
            flex-shrink: 0;
          ">
            <option value="EXAMEN" ${item.type === 'EXAMEN' ? 'selected' : ''}>📋 Examen</option>
            <option value="ENTREGA" ${item.type === 'ENTREGA' ? 'selected' : ''}>🗓️ Entrega</option>
            <option value="OTRO" ${item.type === 'OTRO' ? 'selected' : ''}>💻 Práctica</option>
          </select>

          <!-- Name Input -->
          <input type="text" class="cursa-item-name-input" data-idx="${originalIndex}" data-group="${escapeHtml(group.name)}" data-sub="${escapeHtml(sub?.name || '')}" value="${escapeHtml(displayName)}" style="
            font-weight: 500;
            border: 1px solid transparent;
            background: transparent;
            color: var(--gcal-text, #e8eaed);
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 13.5px;
            flex: 1;
            min-width: 140px;
            outline: none;
            transition: all 0.15s ease;
          " onfocus="this.style.borderColor='var(--gcal-accent, #8ab4f8)'; this.style.background='var(--gcal-surface, #282a2d)';" onblur="this.style.borderColor='transparent'; this.style.background='transparent';" />

          <!-- Google Calendar Link -->
          ${
            item.linkedCalendarEventId
              ? `<div style="
                  display: inline-flex;
                  align-items: center;
                  gap: 5px;
                  background: rgba(129, 201, 149, 0.15);
                  color: #81c995;
                  border: 1px solid rgba(129, 201, 149, 0.3);
                  padding: 2px 8px;
                  border-radius: 10px;
                  font-size: 11.5px;
                  font-weight: 500;
                  max-width: 200px;
                  flex-shrink: 0;
                ">
                  <span>🗓️</span>
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${escapeHtml(item.linkedEventTitle || 'Evento')}
                  </span>
                  <button type="button" class="cursa-unlink-btn" data-idx="${originalIndex}" style="
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: #81c995;
                    font-size: 12px;
                    padding: 0 2px;
                  " title="Desvincular">✕</button>
                </div>`
              : `<button type="button" class="cursa-link-cal-btn" data-idx="${originalIndex}" style="
                  background: transparent;
                  border: 1px dashed var(--gcal-border, #444746);
                  color: var(--gcal-secondary-text, #9aa0a6);
                  padding: 2px 8px;
                  border-radius: 10px;
                  font-size: 11px;
                  font-weight: 500;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 4px;
                  flex-shrink: 0;
                  transition: all 0.15s ease;
                " onmouseover="this.style.background='var(--gcal-surface-hover, #35373b)'; this.style.borderColor='var(--gcal-accent, #8ab4f8)'; this.style.color='var(--gcal-accent, #8ab4f8)';" onmouseout="this.style.background='transparent'; this.style.borderColor='var(--gcal-border, #444746)'; this.style.color='var(--gcal-secondary-text, #9aa0a6)';">
                  <span>🔗</span> <span>Vincular</span>
                </button>`
          }
        </div>

        <!-- Right side: Weight, Grade Input, Contribution, Delete -->
        <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
          <!-- Weight Input & relative badge -->
          <div style="display: flex; align-items: center; gap: 4px;">
            <input type="number" min="0" max="100" step="0.5" class="cursa-item-weight-input" data-idx="${originalIndex}" value="${item.weight}" style="
              width: 50px;
              padding: 3px 6px;
              border-radius: 6px;
              border: 1px solid var(--gcal-border, #444746);
              background: var(--gcal-surface, #282a2d);
              color: var(--gcal-text, #e8eaed);
              font-weight: 600;
              text-align: right;
              font-size: 12px;
              outline: none;
            " onfocus="this.style.borderColor='var(--gcal-accent, #8ab4f8)';" onblur="this.style.borderColor='var(--gcal-border, #444746)';" />
            <span style="color: var(--gcal-secondary-text, #9aa0a6); font-size: 11.5px; font-weight: 500;">% peso</span>
            ${
              sub && sub.name
                ? `<span style="font-size: 10.5px; color: var(--gcal-secondary-text, #9aa0a6); font-weight: 500;">
                    (${relInSub}%)
                  </span>`
                : group.name !== 'Evaluación General'
                ? `<span style="font-size: 10.5px; color: var(--gcal-secondary-text, #9aa0a6); font-weight: 500;">
                    (${relInGroup}%)
                  </span>`
                : ''
            }
          </div>

          <!-- Grade Input -->
          <div style="display: flex; align-items: center; gap: 5px;">
            <input type="number" step="0.05" min="0" max="10" placeholder="Pendiente" class="cursa-item-grade-input" data-idx="${originalIndex}" value="${hasGrade ? item.grade : ''}" style="
              width: 72px;
              padding: 3px 6px;
              border-radius: 8px;
              border: 1.5px solid ${hasGrade ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-border, #444746)'};
              background: ${hasGrade ? 'rgba(138, 180, 248, 0.12)' : 'var(--gcal-surface, #282a2d)'};
              color: ${hasGrade ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-text, #e8eaed)'};
              font-weight: ${hasGrade ? '700' : '400'};
              font-style: ${hasGrade ? 'normal' : 'italic'};
              text-align: right;
              font-size: 12.5px;
              outline: none;
              transition: all 0.15s ease;
            " onfocus="this.style.borderColor='var(--gcal-accent, #8ab4f8)';" onblur="this.style.borderColor='${hasGrade ? 'var(--gcal-accent, #8ab4f8)' : 'var(--gcal-border, #444746)'}';" />
            <span style="color: var(--gcal-secondary-text, #9aa0a6); font-size: 11.5px;">/ 10</span>
          </div>

          <!-- Contribution -->
          <div style="width: 75px; text-align: right;">
            <span style="
              font-family: 'Google Sans', Roboto, sans-serif;
              font-weight: 600;
              color: ${hasGrade ? '#81c995' : 'var(--gcal-secondary-text, #9aa0a6)'};
              font-size: 13px;
            ">
              ${hasGrade ? `+${contrib} pts` : '—'}
            </span>
          </div>

          <!-- Delete Row Button -->
          <button type="button" class="cursa-del-item-btn" data-idx="${originalIndex}" style="
            background: none;
            border: none;
            color: var(--gcal-secondary-text, #9aa0a6);
            cursor: pointer;
            font-size: 14px;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
          " onmouseover="this.style.background='rgba(242, 139, 130, 0.15)'; this.style.color='#f28b82';" onmouseout="this.style.background='none'; this.style.color='var(--gcal-secondary-text, #9aa0a6)';" title="Eliminar este ítem">✕</button>
        </div>
      </div>
    `;
  }
  private attachEvents(): void {
    if (!this.containerEl) return;

    // Subject tabs
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-grade-subj-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subj = btn.getAttribute('data-subj');
        if (subj) this.setActiveSubject(subj);
      });
    });

    // Open AI Chat
    this.containerEl.querySelector('#cursa-grades-open-ai-chat')?.addEventListener('click', () => {
      this.openAIChat();
    });
    this.containerEl.querySelector('#cursa-reconfigure-ai-btn')?.addEventListener('click', () => {
      this.openAIChat();
    });

    // Use default template
    this.containerEl.querySelector('#cursa-grades-use-template')?.addEventListener('click', () => {
      this.currentConfig = createInitialSubjectGrades(this.activeSubject);
      saveSubjectGrades(this.currentConfig);
      this.loadSubject(this.activeSubject);
    });

    // Delete grades
    this.containerEl.querySelector('#cursa-delete-grades-btn')?.addEventListener('click', () => {
      if (confirm(`¿Borrar las notas y configuración de ${this.activeSubject}?`)) {
        deleteSubjectGrades(this.activeSubject);
        this.currentConfig = null;
        this.render();
      }
    });

    // Add Item (Top Button)
    this.containerEl.querySelector('#cursa-add-item-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      this.currentConfig.items.push({
        id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: `Evaluación ${this.currentConfig.items.length + 1}`,
        type: 'EXAMEN',
        weight: 10,
        grade: null
      });
      saveSubjectGrades(this.currentConfig);
      this.render();
    });

    // Add Item to Specific Group
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-add-to-group-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupName = btn.getAttribute('data-group') || 'Evaluación General';
        if (!this.currentConfig) return;
        this.currentConfig.items.push({
          id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: `Nueva Evaluación`,
          category: groupName !== 'Evaluación General' ? groupName : undefined,
          type: 'EXAMEN',
          weight: 10,
          grade: null
        });
        saveSubjectGrades(this.currentConfig);
        const groupId = groupName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        this.expandedGroups.add(groupId);
        this.render();
      });
    });

    // Add Item to Specific Subgroup (Topic / Theme)
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-add-to-subgroup-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const group = btn.getAttribute('data-group') || 'Prácticas';
        const sub = btn.getAttribute('data-sub') || 'Tema';
        if (!this.currentConfig) return;
        this.currentConfig.items.push({
          id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: `Nueva Entrega`,
          category: group,
          subcategory: sub,
          type: 'ENTREGA',
          weight: 5,
          grade: null
        });
        saveSubjectGrades(this.currentConfig);
        const groupId = group.toLowerCase().replace(/[^a-z0-9]/g, '_');
        this.expandedGroups.add(groupId);
        this.render();
      });
    });

    // Toggle All Groups
    this.containerEl.querySelector('#cursa-toggle-all-groups-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      const groups = groupGradeItems(this.currentConfig.items, this.currentConfig.blockCutoffs);
      const allExpanded = groups.length > 0 && groups.every((g) => this.expandedGroups.has(g.id));
      if (allExpanded) {
        this.expandedGroups.clear();
      } else {
        groups.forEach((g) => this.expandedGroups.add(g.id));
      }
      this.render();
    });

    // Accordion Header Click (Toggle Single Group)
    this.containerEl.querySelectorAll<HTMLElement>('.cursa-accordion-header').forEach((header) => {
      header.addEventListener('click', (e) => {
        // Prevent toggle if clicking on cutoff input or buttons
        if ((e.target as HTMLElement).closest('.cursa-block-cutoff-input') || (e.target as HTMLElement).closest('button')) {
          return;
        }
        const groupId = header.getAttribute('data-group-id');
        if (!groupId) return;
        if (this.expandedGroups.has(groupId)) {
          this.expandedGroups.delete(groupId);
        } else {
          this.expandedGroups.add(groupId);
        }
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
        if (val !== undefined && !isNaN(val)) {
          this.currentConfig.blockCutoffs[groupName] = val;
        } else {
          delete this.currentConfig.blockCutoffs[groupName];
        }
        saveSubjectGrades(this.currentConfig);
        this.render();
      });
    });

    // Inputs: Item Name
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-name-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        const group = inp.getAttribute('data-group');
        const sub = inp.getAttribute('data-sub');
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items[idx].name = inp.value.trim() || `Ítem ${idx + 1}`;
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

    // Select: Item Type
    this.containerEl.querySelectorAll<HTMLSelectElement>('.cursa-item-type-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.getAttribute('data-idx') || '0', 10);
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items[idx].type = sel.value as GradeItemType;
          saveSubjectGrades(this.currentConfig);
        }
      });
    });

    // Inputs: Item Weight
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-weight-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        const val = parseFloat(inp.value) || 0;
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items[idx].weight = Math.max(0, Math.min(100, val));
          saveSubjectGrades(this.currentConfig);
          this.render();
        }
      });
    });

    // Inputs: Item Grade
    this.containerEl.querySelectorAll<HTMLInputElement>('.cursa-item-grade-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        const val = inp.value.trim() === '' ? null : parseFloat(inp.value);
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items[idx].grade = val !== null && !isNaN(val) ? Math.max(0, Math.min(10, val)) : null;
          saveSubjectGrades(this.currentConfig);
          this.render();
        }
      });
    });

    // Delete item
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-del-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        if (this.currentConfig && this.currentConfig.items[idx]) {
          this.currentConfig.items.splice(idx, 1);
          saveSubjectGrades(this.currentConfig);
          this.render();
        }
      });
    });

    // Link Calendar Event Button
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-link-cal-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        if (!this.currentConfig || !this.currentConfig.items[idx]) return;
        const item = this.currentConfig.items[idx];

        // Hide overlay container temporarily
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
            if (overlay) overlay.style.display = 'block';
            this.render();
          },
          () => {
            if (overlay) overlay.style.display = 'block';
          }
        );
      });
    });

    // Unlink Calendar Event Button
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

    // Cutoff Input
    const cutoffInput = this.containerEl.querySelector('#cursa-cutoff-input') as HTMLInputElement;
    cutoffInput?.addEventListener('change', () => {
      const val = cutoffInput.value.trim() === '' ? undefined : parseFloat(cutoffInput.value);
      if (this.currentConfig) {
        this.currentConfig.minFinalGradeRequired = val && !isNaN(val) ? val : undefined;
        saveSubjectGrades(this.currentConfig);
        this.render();
      }
    });

    // Quick Target Buttons
    this.containerEl.querySelectorAll<HTMLButtonElement>('.cursa-target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = parseFloat(btn.getAttribute('data-target') || '5.0');
        this.currentTarget = target;
        this.render();
      });
    });

    // Slider
    const slider = this.containerEl.querySelector('#cursa-sim-slider') as HTMLInputElement;
    slider?.addEventListener('input', () => {
      this.simulatedScore = parseFloat(slider.value);
      this.render();
    });
  }

  private openAIChat(): void {
    const credits = this.currentConfig?.credits || 6;
    GradesChatModal.getInstance().open(this.activeSubject, credits, (newConfig) => {
      this.currentConfig = newConfig;
      this.loadSubject(this.activeSubject);
    });
  }
}
