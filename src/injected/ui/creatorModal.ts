import { AcademicEventPayload, EventType } from '../../shared/types';
import { AppState } from '../state';
import { GoogleCalendarAdapter } from '../adapter/GoogleCalendarAdapter';
import { OnboardingModal } from './onboardingModal';
import { safeSetInnerHTML, escapeHtml, setupFocusTrap } from '../utils/dom';
import { getIsolatedItem, setIsolatedItem } from '../utils/storage';
import { DAY_NAMES_ES, MONTH_NAMES_ES, DAY_NAMES_EN, MONTH_NAMES_EN, calculateDuration, toISODateString } from '../utils/dateParsers';
import { t, getLocale } from '../../shared/i18n';

export class CreatorModal {
  private static instance: CreatorModal | null = null;
  private modalOverlay: HTMLElement | null = null;
  private selectedType: EventType = 'EXAMEN';
  private selectedSubject: string = '';
  private focusTrapCleanup: (() => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  // Calendar State
  private viewDate: Date = new Date();
  private selectedDate: Date = new Date();

  public static getInstance(): CreatorModal {
    if (!CreatorModal.instance) {
      CreatorModal.instance = new CreatorModal();
    }
    return CreatorModal.instance;
  }

  private constructor() {}

  public open(): void {
    if (this.modalOverlay) {
      this.refreshSubjects();
      this.modalOverlay.style.display = 'flex';
      this.focusTrapCleanup = setupFocusTrap(this.modalOverlay);
      const card = this.modalOverlay.querySelector('#gcal-creator-card') as HTMLElement;
      if (card) {
        card.style.transform = 'scale(1) translateY(0)';
        card.style.opacity = '1';
      }
      return;
    }

    this.render();
  }

  public close(): void {
    if (this.focusTrapCleanup) {
      this.focusTrapCleanup();
      this.focusTrapCleanup = null;
    }
    if (this.modalOverlay) {
      const card = this.modalOverlay.querySelector('#gcal-creator-card') as HTMLElement;
      if (card) {
        card.style.transform = 'scale(0.96) translateY(8px)';
        card.style.opacity = '0';
      }
      setTimeout(() => {
        if (this.modalOverlay) {
          this.modalOverlay.style.display = 'none';
          const errorEl = this.modalOverlay.querySelector('#gcal-creator-error') as HTMLElement;
          if (errorEl) errorEl.style.display = 'none';
        }
      }, 150);
    }
  }

  private refreshSubjects(): void {
    if (!this.modalOverlay) return;
    const select = this.modalOverlay.querySelector('#gcal-field-subject') as HTMLSelectElement;
    if (select) {
      const classes = GoogleCalendarAdapter.getInstance().getDetectedClasses();
      safeSetInnerHTML(
        select,
        classes.map((c) => `<option value="${escapeHtml(c)}" ${c === this.selectedSubject ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')
      );
      if (classes.length > 0 && (!this.selectedSubject || !classes.includes(this.selectedSubject))) {
        this.selectedSubject = classes[0];
        select.value = this.selectedSubject;
      }
    }
  }

  private formatDateDisplay(date: Date): string {
    const isEn = getLocale() === 'en';
    const dayName = isEn ? DAY_NAMES_EN[date.getDay()] : DAY_NAMES_ES[date.getDay()];
    const dayNum = date.getDate();
    const monthName = isEn ? MONTH_NAMES_EN[date.getMonth()] : MONTH_NAMES_ES[date.getMonth()];
    const year = date.getFullYear();
    return isEn ? `${dayName}, ${monthName} ${dayNum}, ${year}` : `${dayName}, ${dayNum} de ${monthName} de ${year}`;
  }

  private toISODate(date: Date): string {
    return toISODateString(date);
  }

  private updateDuration(): void {
    if (!this.modalOverlay) return;
    const startInput = this.modalOverlay.querySelector('#gcal-field-start-time') as HTMLInputElement;
    const endInput = this.modalOverlay.querySelector('#gcal-field-end-time') as HTMLInputElement;
    const durationLabel = this.modalOverlay.querySelector('#gcal-duration-text') as HTMLElement;

    if (!startInput || !endInput || !durationLabel) return;

    const startVal = startInput.value;
    const endVal = endInput.value;
    if (!startVal || !endVal) return;

    const text = calculateDuration(startVal, endVal);
    durationLabel.textContent = `⏱️ Duración: ${text}`;
  }

  private render(): void {
    this.modalOverlay = document.createElement('div');
    this.modalOverlay.id = 'gcal-academic-creator-modal';
    this.modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.55);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      font-family: 'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      opacity: 1;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    const now = new Date();
    this.selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this.viewDate = new Date(this.selectedDate);

    const defaultStartHour = String((now.getHours() + 1) % 24).padStart(2, '0') + ':00';
    const defaultEndHour = String((now.getHours() + 3) % 24).padStart(2, '0') + ':00';

    const detectedClasses = GoogleCalendarAdapter.getInstance().getDetectedClasses();
    this.selectedSubject = detectedClasses[0] || 'Asignatura 1';

    safeSetInnerHTML(
      this.modalOverlay,
      `
      <div id="gcal-creator-card" style="
        background: var(--gcal-surface, #ffffff);
        color: var(--gcal-text, #1f1f1f);
        border: 1px solid var(--gcal-border, #dadce0);
        border-radius: 20px;
        width: 710px;
        max-width: 95vw;
        max-height: 94vh;
        overflow-y: auto;
        padding: 24px 26px;
        box-shadow: 0 24px 50px -10px rgba(0, 0, 0, 0.28), 0 4px 16px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-sizing: border-box;
        transform: scale(1) translateY(0);
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
      ">
        <!-- Top Bar: Title & Close -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="
              width: 38px;
              height: 38px;
              border-radius: 12px;
              background: rgba(26, 115, 232, 0.12);
              color: var(--gcal-accent, #1a73e8);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 20px;
            ">🎓</div>
            <div>
              <h2 style="margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.2px;">Nuevo Evento Académico</h2>
              <span style="font-size: 11.5px; color: var(--gcal-secondary-text, #5f6368);">Sincronizado con tus calendarios universitarios</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px;">
            <!-- Segmented Control: Examen vs Entrega -->
            <div style="
              display: flex;
              background: var(--gcal-surface-hover, #f1f3f4);
              padding: 3px;
              border-radius: 10px;
              gap: 3px;
            ">
              <button id="gcal-type-examen" type="button" style="
                padding: 6px 14px;
                border-radius: 8px;
                border: 1px solid rgba(0,0,0,0.06);
                background: var(--gcal-surface, #ffffff);
                color: var(--gcal-accent, #1a73e8);
                font-weight: 600;
                font-size: 12.5px;
                cursor: pointer;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s ease;
              ">
                <span>📋</span> <span>Examen</span>
              </button>
              <button id="gcal-type-entrega" type="button" style="
                padding: 6px 14px;
                border-radius: 8px;
                border: 1px solid transparent;
                background: transparent;
                color: var(--gcal-secondary-text, #5f6368);
                font-weight: 500;
                font-size: 12.5px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s ease;
              ">
                <span>🗓️</span> <span>Entrega</span>
              </button>
            </div>

            <!-- Close button -->
            <button id="gcal-creator-close" style="
              background: none;
              border: none;
              width: 32px;
              height: 32px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 18px;
              cursor: pointer;
              color: var(--gcal-secondary-text, #5f6368);
              transition: background 0.15s ease;
            " onmouseover="this.style.background='var(--gcal-surface-hover, #f1f3f4)'" onmouseout="this.style.background='none'">&times;</button>
          </div>
        </div>

        <!-- Target Destination Badge -->
        <div id="gcal-target-dest" style="
          font-size: 11.5px;
          color: var(--gcal-secondary-text, #5f6368);
          background: var(--gcal-surface-hover, #f1f3f4);
          padding: 6px 12px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          <span>Destino automático:</span> <strong style="color: var(--gcal-text, #1f1f1f); font-weight: 600;">📋 Examenes</strong>
        </div>

        <!-- Main Body: 2 Columns Grid -->
        <div style="
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 20px;
          align-items: start;
        ">
          <!-- Left Column: Asignatura, Título, Horario, Descripción -->
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <!-- Asignatura con Emojis -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <label for="gcal-field-subject" style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #5f6368);">
                  ASIGNATURA *
                </label>
                <button id="gcal-manage-subjects-btn" type="button" style="
                  background: transparent;
                  border: none;
                  color: var(--gcal-accent, #1a73e8);
                  font-size: 11px;
                  font-weight: 600;
                  cursor: pointer;
                  padding: 0;
                ">⚙️ Gestionar asignaturas</button>
              </div>
              <div style="position: relative;">
                <select id="gcal-field-subject" style="
                  width: 100%;
                  box-sizing: border-box;
                  padding: 9px 36px 9px 12px;
                  border-radius: 10px;
                  border: 1px solid var(--gcal-border, #dadce0);
                  background: var(--gcal-surface, #ffffff);
                  color: var(--gcal-text, #1f1f1f);
                  font-size: 13.5px;
                  font-weight: 500;
                  outline: none;
                  cursor: pointer;
                  appearance: none;
                  -webkit-appearance: none;
                ">
                  ${detectedClasses.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                </select>
                <div style="
                  position: absolute;
                  right: 12px;
                  top: 50%;
                  transform: translateY(-50%);
                  pointer-events: none;
                  color: var(--gcal-secondary-text, #5f6368);
                  font-size: 11px;
                ">▼</div>
              </div>
            </div>

            <!-- Título -->
            <div>
              <label for="gcal-field-title" style="display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #5f6368); margin-bottom: 5px;">
                TÍTULO *
              </label>
              <input id="gcal-field-title" type="text" placeholder="Ej: Parcial 1, Práctica 2..." style="
                width: 100%;
                box-sizing: border-box;
                padding: 9px 12px;
                border-radius: 10px;
                border: 1px solid var(--gcal-border, #dadce0);
                background: var(--gcal-surface, #ffffff);
                color: var(--gcal-text, #1f1f1f);
                font-size: 13.5px;
                outline: none;
              " />
            </div>

            <!-- Horas: Inicio y Fin -->
            <div>
              <label style="display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #5f6368); margin-bottom: 5px;">
                HORARIO *
              </label>
              <div style="display: flex; gap: 8px; align-items: center;">
                <div style="flex: 1;">
                  <span style="display: block; font-size: 10.5px; color: var(--gcal-secondary-text, #5f6368); margin-bottom: 3px;">Inicio</span>
                  <input id="gcal-field-start-time" type="time" value="${defaultStartHour}" style="
                    width: 100%;
                    box-sizing: border-box;
                    padding: 8px 10px;
                    border-radius: 8px;
                    border: 1px solid var(--gcal-border, #dadce0);
                    background: var(--gcal-surface, #ffffff);
                    color: var(--gcal-text, #1f1f1f);
                    font-size: 13px;
                    font-family: inherit;
                    outline: none;
                  " />
                </div>

                <div style="padding-top: 14px; color: var(--gcal-secondary-text, #5f6368); font-size: 12px;">➔</div>

                <div style="flex: 1;">
                  <span style="display: block; font-size: 10.5px; color: var(--gcal-secondary-text, #5f6368); margin-bottom: 3px;">Fin</span>
                  <input id="gcal-field-end-time" type="time" value="${defaultEndHour}" style="
                    width: 100%;
                    box-sizing: border-box;
                    padding: 8px 10px;
                    border-radius: 8px;
                    border: 1px solid var(--gcal-border, #dadce0);
                    background: var(--gcal-surface, #ffffff);
                    color: var(--gcal-text, #1f1f1f);
                    font-size: 13px;
                    font-family: inherit;
                    outline: none;
                  " />
                </div>
              </div>

              <!-- Duration & Quick Chips -->
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
                <span id="gcal-duration-text" style="font-size: 11.5px; font-weight: 600; color: var(--gcal-accent, #1a73e8);">
                  ⏱️ Duración: 2 horas
                </span>
                <div style="display: flex; gap: 4px;">
                  <button class="gcal-dur-preset" data-dur="30" type="button" style="
                    padding: 2px 7px;
                    border-radius: 5px;
                    border: 1px solid var(--gcal-border, #dadce0);
                    background: var(--gcal-surface-hover, #f1f3f4);
                    color: var(--gcal-text, #1f1f1f);
                    font-size: 10.5px;
                    cursor: pointer;
                  ">+30m</button>
                  <button class="gcal-dur-preset" data-dur="60" type="button" style="
                    padding: 2px 7px;
                    border-radius: 5px;
                    border: 1px solid var(--gcal-border, #dadce0);
                    background: var(--gcal-surface-hover, #f1f3f4);
                    color: var(--gcal-text, #1f1f1f);
                    font-size: 10.5px;
                    cursor: pointer;
                  ">+1h</button>
                  <button class="gcal-dur-preset" data-dur="90" type="button" style="
                    padding: 2px 7px;
                    border-radius: 5px;
                    border: 1px solid var(--gcal-border, #dadce0);
                    background: var(--gcal-surface-hover, #f1f3f4);
                    color: var(--gcal-text, #1f1f1f);
                    font-size: 10.5px;
                    cursor: pointer;
                  ">+1.5h</button>
                  <button class="gcal-dur-preset" data-dur="120" type="button" style="
                    padding: 2px 7px;
                    border-radius: 5px;
                    border: 1px solid var(--gcal-border, #dadce0);
                    background: var(--gcal-surface-hover, #f1f3f4);
                    color: var(--gcal-text, #1f1f1f);
                    font-size: 10.5px;
                    cursor: pointer;
                  ">+2h</button>
                </div>
              </div>
            </div>

            <!-- Descripción (Opcional) -->
            <div>
              <label for="gcal-field-desc" style="display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #5f6368); margin-bottom: 5px;">
                DESCRIPCIÓN (OPCIONAL)
              </label>
              <textarea id="gcal-field-desc" rows="2" placeholder="Aula, temario o notas..." style="
                width: 100%;
                box-sizing: border-box;
                padding: 8px 10px;
                border-radius: 8px;
                border: 1px solid var(--gcal-border, #dadce0);
                background: var(--gcal-surface, #ffffff);
                color: var(--gcal-text, #1f1f1f);
                font-size: 12.5px;
                outline: none;
                resize: vertical;
                font-family: inherit;
              "></textarea>
            </div>
          </div>

          <!-- Right Column: Visual Interactive Calendar ("Calendario chulo") -->
          <div style="
            background: var(--gcal-surface, #ffffff);
            border: 1px solid var(--gcal-border, #dadce0);
            border-radius: 14px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
          ">
            <!-- Selected Date Tag -->
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: var(--gcal-secondary-text, #5f6368);">
                FECHA SELECCIONADA
              </span>
              <span id="gcal-date-badge-short" style="
                font-size: 11px;
                font-weight: 600;
                color: var(--gcal-accent, #1a73e8);
                background: var(--gcal-surface-hover, #f1f3f4);
                padding: 2px 8px;
                border-radius: 6px;
              ">
                ${this.selectedDate.getDate()} ${MONTH_NAMES_ES[this.selectedDate.getMonth()].slice(0, 3)}
              </span>
            </div>

            <!-- Formatted Date Label -->
            <div id="gcal-date-formatted-text" style="
              font-size: 12.5px;
              font-weight: 600;
              color: var(--gcal-text, #1f1f1f);
              background: var(--gcal-surface-hover, #f1f3f4);
              padding: 7px 10px;
              border-radius: 8px;
              display: flex;
              align-items: center;
              gap: 6px;
            ">
              <span>📅</span> <span>${this.formatDateDisplay(this.selectedDate)}</span>
            </div>

            <input type="hidden" id="gcal-field-date" value="${this.toISODate(this.selectedDate)}" />

            <!-- Shortcuts Bar -->
            <div style="display: flex; gap: 4px; justify-content: space-between;">
              <button id="gcal-cal-preset-today" type="button" style="
                flex: 1;
                padding: 4px;
                border-radius: 6px;
                border: 1px solid var(--gcal-border, #dadce0);
                background: var(--gcal-surface-hover, #f1f3f4);
                color: var(--gcal-text, #1f1f1f);
                font-size: 11px;
                font-weight: 500;
                cursor: pointer;
              ">Hoy</button>
              <button id="gcal-cal-preset-tomorrow" type="button" style="
                flex: 1;
                padding: 4px;
                border-radius: 6px;
                border: 1px solid var(--gcal-border, #dadce0);
                background: var(--gcal-surface-hover, #f1f3f4);
                color: var(--gcal-text, #1f1f1f);
                font-size: 11px;
                font-weight: 500;
                cursor: pointer;
              ">Mañana</button>
              <button id="gcal-cal-preset-7days" type="button" style="
                flex: 1.2;
                padding: 4px;
                border-radius: 6px;
                border: 1px solid var(--gcal-border, #dadce0);
                background: var(--gcal-surface-hover, #f1f3f4);
                color: var(--gcal-text, #1f1f1f);
                font-size: 11px;
                font-weight: 500;
                cursor: pointer;
              ">En 7 días</button>
            </div>

            <!-- Month Nav Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 2px;">
              <span id="gcal-cal-month-title" style="font-size: 13px; font-weight: 600; color: var(--gcal-text, #1f1f1f);">
                ${MONTH_NAMES_ES[this.viewDate.getMonth()]} ${this.viewDate.getFullYear()}
              </span>
              <div style="display: flex; gap: 4px;">
                <button id="gcal-cal-prev-month" type="button" style="
                  width: 26px;
                  height: 26px;
                  border-radius: 50%;
                  border: 1px solid var(--gcal-border, #dadce0);
                  background: var(--gcal-surface, #ffffff);
                  color: var(--gcal-text, #1f1f1f);
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 11px;
                ">&lt;</button>
                <button id="gcal-cal-next-month" type="button" style="
                  width: 26px;
                  height: 26px;
                  border-radius: 50%;
                  border: 1px solid var(--gcal-border, #dadce0);
                  background: var(--gcal-surface, #ffffff);
                  color: var(--gcal-text, #1f1f1f);
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 11px;
                ">&gt;</button>
              </div>
            </div>

            <!-- Weekday headers -->
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 10.5px; font-weight: 600; color: var(--gcal-secondary-text, #5f6368);">
              <div>Lu</div>
              <div>Ma</div>
              <div>Mi</div>
              <div>Ju</div>
              <div>Vi</div>
              <div>Sá</div>
              <div>Do</div>
            </div>

            <!-- Days Grid -->
            <div id="gcal-cal-days-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;"></div>
          </div>
        </div>

        <!-- Mensaje de Error de Validación -->
        <div id="gcal-creator-error" style="
          display: none;
          font-size: 12px;
          color: #d93025;
          font-weight: 600;
          background: #fce8e6;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #fad2cf;
        "></div>

        <!-- Footer Actions -->
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 2px;">
          <button id="gcal-creator-cancel" type="button" style="
            padding: 9px 18px;
            border-radius: 10px;
            border: 1px solid var(--gcal-border, #dadce0);
            background: transparent;
            color: var(--gcal-text, #1f1f1f);
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.15s ease;
          " onmouseover="this.style.background='var(--gcal-surface-hover, #f1f3f4)'" onmouseout="this.style.background='transparent'">${t('btn_cancel')}</button>

          <button id="gcal-creator-submit" type="button" style="
            padding: 9px 24px;
            border-radius: 10px;
            border: none;
            background: var(--gcal-accent, #1a73e8);
            color: #ffffff;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 3px 8px rgba(26, 115, 232, 0.35);
            transition: all 0.15s ease;
          " onmouseover="this.style.background='#1557b0'; this.style.boxShadow='0 4px 12px rgba(26, 115, 232, 0.45)'" onmouseout="this.style.background='var(--gcal-accent, #1a73e8)'; this.style.boxShadow='0 3px 8px rgba(26, 115, 232, 0.35)'">
            <span>${t('btn_create')}</span>
          </button>
        </div>
      </div>
    `);

    document.body.appendChild(this.modalOverlay);
    this.focusTrapCleanup = setupFocusTrap(this.modalOverlay);
    this.renderCalendarGrid();
    this.updateDuration();
    this.setupListeners();
  }

  private renderCalendarGrid(): void {
    if (!this.modalOverlay) return;
    const grid = this.modalOverlay.querySelector('#gcal-cal-days-grid') as HTMLElement;
    const title = this.modalOverlay.querySelector('#gcal-cal-month-title') as HTMLElement;
    if (!grid || !title) return;

    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    const isEn = getLocale() === 'en';
    const monthName = isEn ? MONTH_NAMES_EN[month] : MONTH_NAMES_ES[month];
    title.textContent = `${monthName} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevLastDay = new Date(year, month, 0);

    // Monday-based week: 0 = Mon, 6 = Sun
    const startDayOfWeek = (firstDay.getDay() + 6) % 7;
    const totalDaysInMonth = lastDay.getDate();

    const today = new Date();
    const isTodayYearMonth = today.getFullYear() === year && today.getMonth() === month;

    const isSelectedYearMonth =
      this.selectedDate.getFullYear() === year && this.selectedDate.getMonth() === month;

    let html = '';

    // Prev month trailing days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = prevLastDay.getDate() - i;
      html += `
        <button type="button" class="gcal-cal-day-cell prev-month" data-day="${d}" data-month="${month - 1}" data-year="${year}" style="
          border: none;
          background: transparent;
          color: var(--gcal-disabled, #9aa0a6);
          height: 28px;
          border-radius: 6px;
          font-size: 11px;
          cursor: pointer;
          opacity: 0.55;
          display: flex;
          align-items: center;
          justify-content: center;
        ">${d}</button>
      `;
    }

    // Current month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const isSelected = isSelectedYearMonth && this.selectedDate.getDate() === d;
      const isCurrentDay = isTodayYearMonth && today.getDate() === d;

      let cellStyle = `
        border: none;
        height: 28px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      `;

      if (isSelected) {
        cellStyle += `
          background: var(--gcal-accent, #1a73e8);
          color: #ffffff;
          font-weight: 700;
          box-shadow: 0 2px 6px rgba(26, 115, 232, 0.4);
          transform: scale(1.05);
        `;
      } else if (isCurrentDay) {
        cellStyle += `
          background: var(--gcal-surface-hover, #f1f3f4);
          color: var(--gcal-accent, #1a73e8);
          font-weight: 700;
          border: 1px solid var(--gcal-accent, #1a73e8);
        `;
      } else {
        cellStyle += `
          background: transparent;
          color: var(--gcal-text, #1f1f1f);
        `;
      }

      html += `
        <button type="button" class="gcal-cal-day-cell current-month" data-day="${d}" data-month="${month}" data-year="${year}" style="${cellStyle}"
          onmouseover="if(!this.style.background.includes('1a73e8')) this.style.background='var(--gcal-surface-hover, #f1f3f4)'"
          onmouseout="if(!this.style.background.includes('1a73e8')) this.style.background='transparent'">
          ${d}
        </button>
      `;
    }

    // Next month filling days
    const totalRendered = startDayOfWeek + totalDaysInMonth;
    const remaining = (7 - (totalRendered % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      html += `
        <button type="button" class="gcal-cal-day-cell next-month" data-day="${d}" data-month="${month + 1}" data-year="${year}" style="
          border: none;
          background: transparent;
          color: var(--gcal-disabled, #9aa0a6);
          height: 28px;
          border-radius: 6px;
          font-size: 11px;
          cursor: pointer;
          opacity: 0.55;
          display: flex;
          align-items: center;
          justify-content: center;
        ">${d}</button>
      `;
    }

    safeSetInnerHTML(grid, html);

    // Bind click events on day cells
    const cells = grid.querySelectorAll('.gcal-cal-day-cell');
    cells.forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = parseInt(cell.getAttribute('data-day') || '1', 10);
        const m = parseInt(cell.getAttribute('data-month') || String(month), 10);
        const y = parseInt(cell.getAttribute('data-year') || String(year), 10);
        this.selectDate(new Date(y, m, d));
      });
    });
  }

  private selectDate(date: Date): void {
    this.selectedDate = date;
    this.viewDate = new Date(date);
    if (!this.modalOverlay) return;

    const formattedLabel = this.modalOverlay.querySelector('#gcal-date-formatted-text') as HTMLElement;
    const shortBadge = this.modalOverlay.querySelector('#gcal-date-badge-short') as HTMLElement;
    const hiddenDateInput = this.modalOverlay.querySelector('#gcal-field-date') as HTMLInputElement;

    if (formattedLabel) {
      safeSetInnerHTML(formattedLabel, `<span>📅</span> <span>${this.formatDateDisplay(date)}</span>`);
    }
    if (shortBadge) {
      shortBadge.textContent = `${date.getDate()} ${MONTH_NAMES_ES[date.getMonth()].slice(0, 3)}`;
    }
    if (hiddenDateInput) {
      hiddenDateInput.value = this.toISODate(date);
    }

    this.renderCalendarGrid();
  }

  private setupListeners(): void {
    if (!this.modalOverlay) return;

    const closeBtn = this.modalOverlay.querySelector('#gcal-creator-close');
    const cancelBtn = this.modalOverlay.querySelector('#gcal-creator-cancel');
    const submitBtn = this.modalOverlay.querySelector('#gcal-creator-submit') as HTMLButtonElement;
    const typeExamenBtn = this.modalOverlay.querySelector('#gcal-type-examen') as HTMLButtonElement;
    const typeEntregaBtn = this.modalOverlay.querySelector('#gcal-type-entrega') as HTMLButtonElement;
    const destLabel = this.modalOverlay.querySelector('#gcal-target-dest') as HTMLElement;
    const subjectSelect = this.modalOverlay.querySelector('#gcal-field-subject') as HTMLSelectElement;

    const prevMonthBtn = this.modalOverlay.querySelector('#gcal-cal-prev-month');
    const nextMonthBtn = this.modalOverlay.querySelector('#gcal-cal-next-month');

    const presetToday = this.modalOverlay.querySelector('#gcal-cal-preset-today');
    const presetTomorrow = this.modalOverlay.querySelector('#gcal-cal-preset-tomorrow');
    const preset7Days = this.modalOverlay.querySelector('#gcal-cal-preset-7days');

    const startTimeInput = this.modalOverlay.querySelector('#gcal-field-start-time') as HTMLInputElement;
    const endTimeInput = this.modalOverlay.querySelector('#gcal-field-end-time') as HTMLInputElement;

    // Close on overlay backdrop click
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) {
        this.close();
      }
    });

    // Close on Escape key
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.modalOverlay && this.modalOverlay.style.display !== 'none') {
        this.close();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    closeBtn?.addEventListener('click', () => this.close());
    cancelBtn?.addEventListener('click', () => this.close());

    // Switch type to EXAMEN
    typeExamenBtn?.addEventListener('click', () => {
      this.selectedType = 'EXAMEN';
      typeExamenBtn.style.background = 'var(--gcal-surface, #ffffff)';
      typeExamenBtn.style.color = 'var(--gcal-accent, #1a73e8)';
      typeExamenBtn.style.fontWeight = '600';
      typeExamenBtn.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.08)';
      typeExamenBtn.style.borderColor = 'rgba(0,0,0,0.06)';

      typeEntregaBtn.style.background = 'transparent';
      typeEntregaBtn.style.color = 'var(--gcal-secondary-text, #5f6368)';
      typeEntregaBtn.style.fontWeight = '500';
      typeEntregaBtn.style.boxShadow = 'none';
      typeEntregaBtn.style.borderColor = 'transparent';

      if (destLabel) {
        safeSetInnerHTML(
          destLabel,
          `<span>Destino automático:</span> <strong style="color: var(--gcal-text, #1f1f1f); font-weight: 600;">📋 Examenes</strong>`
        );
      }
    });

    // Switch type to ENTREGA
    typeEntregaBtn?.addEventListener('click', () => {
      this.selectedType = 'ENTREGA';
      typeEntregaBtn.style.background = 'var(--gcal-surface, #ffffff)';
      typeEntregaBtn.style.color = 'var(--gcal-accent, #1a73e8)';
      typeEntregaBtn.style.fontWeight = '600';
      typeEntregaBtn.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.08)';
      typeEntregaBtn.style.borderColor = 'rgba(0,0,0,0.06)';

      typeExamenBtn.style.background = 'transparent';
      typeExamenBtn.style.color = 'var(--gcal-secondary-text, #5f6368)';
      typeExamenBtn.style.fontWeight = '500';
      typeExamenBtn.style.boxShadow = 'none';
      typeExamenBtn.style.borderColor = 'transparent';

      if (destLabel) {
        safeSetInnerHTML(
          destLabel,
          `<span>Destino automático:</span> <strong style="color: var(--gcal-text, #1f1f1f); font-weight: 600;">🗓️ Entregas</strong>`
        );
      }
    });

    subjectSelect?.addEventListener('change', () => {
      this.selectedSubject = subjectSelect.value;
    });

    const manageBtn = this.modalOverlay.querySelector('#gcal-manage-subjects-btn');
    manageBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      OnboardingModal.getInstance().open();
    });

    // Month Navigation
    prevMonthBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() - 1, 1);
      this.renderCalendarGrid();
    });

    nextMonthBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 1);
      this.renderCalendarGrid();
    });

    // Date Presets
    presetToday?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectDate(new Date());
    });

    presetTomorrow?.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = new Date();
      d.setDate(d.getDate() + 1);
      this.selectDate(d);
    });

    preset7Days?.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = new Date();
      d.setDate(d.getDate() + 7);
      this.selectDate(d);
    });

    // Time change listeners
    startTimeInput?.addEventListener('input', () => {
      const sVal = startTimeInput.value;
      const eVal = endTimeInput.value;
      if (sVal && eVal) {
        const [sh, sm] = sVal.split(':').map(Number);
        const [eh, em] = eVal.split(':').map(Number);
        const sMins = sh * 60 + sm;
        const eMins = eh * 60 + em;
        if (eMins <= sMins) {
          const newEndH = String((sh + 1) % 24).padStart(2, '0');
          endTimeInput.value = `${newEndH}:${String(sm).padStart(2, '0')}`;
        }
      }
      this.updateDuration();
    });

    endTimeInput?.addEventListener('input', () => {
      this.updateDuration();
    });

    // Duration preset chips
    const durationChips = this.modalOverlay.querySelectorAll('.gcal-dur-preset');
    durationChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const addMinutes = parseInt(chip.getAttribute('data-dur') || '60', 10);
        const sVal = startTimeInput.value || '09:00';
        const [sh, sm] = sVal.split(':').map(Number);
        const totalEndMins = (sh * 60 + sm + addMinutes) % (24 * 60);
        const eh = String(Math.floor(totalEndMins / 60)).padStart(2, '0');
        const em = String(totalEndMins % 60).padStart(2, '0');
        endTimeInput.value = `${eh}:${em}`;
        this.updateDuration();
      });
    });

    submitBtn?.addEventListener('click', () => this.handleSubmit());
  }

  private async handleSubmit(): Promise<void> {
    if (!this.modalOverlay) return;

    const appState = AppState.getInstance();
    if (appState.getState().isSubmitting) return;

    const errorEl = this.modalOverlay.querySelector('#gcal-creator-error') as HTMLElement;
    const submitBtn = this.modalOverlay.querySelector('#gcal-creator-submit') as HTMLButtonElement;
    const titleInput = this.modalOverlay.querySelector('#gcal-field-title') as HTMLInputElement;
    const subjectSelect = this.modalOverlay.querySelector('#gcal-field-subject') as HTMLSelectElement;
    const dateInput = this.modalOverlay.querySelector('#gcal-field-date') as HTMLInputElement;
    const startTimeInput = this.modalOverlay.querySelector('#gcal-field-start-time') as HTMLInputElement;
    const endTimeInput = this.modalOverlay.querySelector('#gcal-field-end-time') as HTMLInputElement;
    const descInput = this.modalOverlay.querySelector('#gcal-field-desc') as HTMLTextAreaElement;

    const title = titleInput.value.trim();
    const subject = subjectSelect.value.trim();
    const date = dateInput.value.trim();
    const startTime = startTimeInput.value.trim();
    const endTime = endTimeInput.value.trim();
    const description = descInput.value.trim();

    if (!title) {
      this.showError('Por favor, escribe un título para el evento.');
      titleInput.focus();
      return;
    }
    if (!subject) {
      this.showError('Por favor, selecciona una asignatura.');
      subjectSelect.focus();
      return;
    }
    if (!date) {
      this.showError('Por favor, selecciona una fecha en el calendario.');
      return;
    }
    if (!startTime) {
      this.showError('Por favor, indica una hora de inicio válida.');
      startTimeInput.focus();
      return;
    }
    if (!endTime) {
      this.showError('Por favor, indica una hora de fin válida.');
      endTimeInput.focus();
      return;
    }

    appState.setSubmitting(true);
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    submitBtn.innerText = t('btn_creating');
    if (errorEl) errorEl.style.display = 'none';

    try {
      const payload: AcademicEventPayload = {
        type: this.selectedType,
        subject,
        title,
        description,
        date,
        startTime,
        endTime,
        time: startTime
      };

      try {
        const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
        const cleanKey = title.toLowerCase().trim();
        const fullKey = `${cleanKey}_${subject.toLowerCase().trim()}`;
        let termKey = '';
        try {
          const rawPlan = getIsolatedItem('gcal_academic_plan');
          if (rawPlan) {
            const p = JSON.parse(rawPlan);
            if (p && p.currentYear && p.currentPeriod) {
              termKey = `Y${p.currentYear}-P${p.currentPeriod}`;
            }
          }
        } catch (_) {}
        meta[cleanKey] = { ...(meta[cleanKey] || {}), description, subject, type: this.selectedType, termKey };
        meta[fullKey] = { ...(meta[fullKey] || {}), description, subject, type: this.selectedType, termKey };
        setIsolatedItem('gcal_academic_meta', JSON.stringify(meta));
      } catch (_) {}

      const adapter = GoogleCalendarAdapter.getInstance();
      const ok = await adapter.createAcademicEvent(payload);

      if (!ok) {
        this.showError('No se pudo guardar el evento automáticamente en Google Calendar. Comprueba tu conexión o inténtalo de nuevo.');
        return;
      }

      // Guarantee tab remains ENTREGAS_EXAMENES across reload/navigation
      appState.setActiveTab('ENTREGAS_EXAMENES');
      adapter.applyTabFilter('ENTREGAS_EXAMENES', true);

      // Show confirmation toast and persist across cloud-sync navigation
      const destCalName = this.selectedType === 'EXAMEN' ? '📋 Exámenes' : '🗓️ Entregas';
      const toastMsg = `✓ Evento guardado correctamente en ${destCalName}`;
      this.showToast(toastMsg);

      titleInput.value = '';
      descInput.value = '';
      this.close();

      // Reload/navigate calendar grid onto the created event's date so Google Calendar fetches the cloud event immediately
      setTimeout(() => {
        adapter.navigateToEventDate(date, toastMsg);
      }, 450);
    } catch (_err) {
      this.showError('Error al crear el evento en Google Calendar.');
    } finally {
      appState.setSubmitting(false);
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.innerText = t('btn_create');
    }
  }

  private showToast(message: string): void {
    const existing = document.querySelector('#gcal-toast-msg');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'gcal-toast-msg';
    toast.style.cssText = `
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #1e293b;
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 28px;
      font-size: 13.5px;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      z-index: 9999999;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      font-family: 'Google Sans', Roboto, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(12px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  private showError(message: string): void {
    if (!this.modalOverlay) return;
    const errorEl = this.modalOverlay.querySelector('#gcal-creator-error') as HTMLElement;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  public destroy(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.focusTrapCleanup) {
      this.focusTrapCleanup();
      this.focusTrapCleanup = null;
    }
    if (this.modalOverlay && this.modalOverlay.parentNode) {
      this.modalOverlay.parentNode.removeChild(this.modalOverlay);
      this.modalOverlay = null;
    }
    CreatorModal.instance = null;
  }
}
