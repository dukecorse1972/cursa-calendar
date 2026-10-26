import { GoogleCalendarAdapter } from '../adapter/GoogleCalendarAdapter';
import { safeSetInnerHTML, escapeHtml, setupFocusTrap } from '../utils/dom';
import { AcademicEventPayload } from '../../shared/types';
import { getIsolatedItem, setIsolatedItem } from '../utils/storage';
import {
  parseAcademicDateString,
  calculateDuration,
  DAY_NAMES_ES,
  MONTH_NAMES_ES
} from '../utils/dateParsers';

export interface AcademicEventDetail {
  type: 'EXAMEN' | 'ENTREGA';
  subject: string;
  title: string;
  description: string;
  dateStr: string;
  isoDate: string;
  startTime: string;
  endTime: string;
  durationStr: string;
  countdownStr: string;
  countdownStatus: 'urgent' | 'today' | 'upcoming' | 'past';
  calendar: string;
  subjectColor: string;
  eventId: string;
  chipElement: HTMLElement;
  isCompleted: boolean;
}

export class AcademicDetailModal {
  private static instance: AcademicDetailModal | null = null;
  private modalOverlay: HTMLElement | null = null;
  private currentDetail: AcademicEventDetail | null = null;
  private isEditingNotes = false;
  private isDeleting = false;
  private isCompletePanelOpen = false;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private focusTrapCleanup: (() => void) | null = null;

  // Rescheduling state
  private isRescheduling = false;
  private rescheduleDate: Date = new Date();
  private rescheduleCalendarViewDate: Date = new Date();
  private rescheduleStartTime: string = '09:00';
  private rescheduleEndTime: string = '11:00';

  public static getInstance(): AcademicDetailModal {
    if (!AcademicDetailModal.instance) {
      AcademicDetailModal.instance = new AcademicDetailModal();
    }
    return AcademicDetailModal.instance;
  }

  private constructor() {}

  public open(chip: HTMLElement): void {
    this.close();
    const detail = this.parseChipData(chip);
    this.currentDetail = detail;
    this.isEditingNotes = false;
    this.isDeleting = false;
    this.isCompletePanelOpen = false;
    this.isRescheduling = false;

    // Initialize reschedule dates
    if (detail.isoDate && /^\d{4}-\d{2}-\d{2}$/.test(detail.isoDate)) {
      const [y, m, d] = detail.isoDate.split('-').map(Number);
      this.rescheduleDate = new Date(y, m - 1, d);
      this.rescheduleCalendarViewDate = new Date(y, m - 1, 1);
    } else {
      this.rescheduleDate = new Date();
      this.rescheduleCalendarViewDate = new Date();
    }
    this.rescheduleStartTime = detail.startTime || '09:00';
    this.rescheduleEndTime = detail.endTime || '11:00';

    this.render();
  }

  public close(): void {
    if (this.focusTrapCleanup) {
      this.focusTrapCleanup();
      this.focusTrapCleanup = null;
    }
    if (this.escHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.modalOverlay) {
      this.modalOverlay.remove();
      this.modalOverlay = null;
    }
    this.currentDetail = null;
    this.isEditingNotes = false;
    this.isDeleting = false;
    this.isCompletePanelOpen = false;
    this.isRescheduling = false;
  }

  public getModalOverlay(): HTMLElement | null {
    return this.modalOverlay;
  }

  public getCurrentDetail(): AcademicEventDetail | null {
    return this.currentDetail;
  }

  public parseChipData(chip: HTMLElement): AcademicEventDetail {
    const adapter = GoogleCalendarAdapter.getInstance();
    const colorMap = adapter.getSubjectColorMap();

    const rawAria = chip.getAttribute('aria-label') || '';
    const ariaHidden = chip.querySelector('.XuJrye')?.textContent || '';
    const enhancedAttr = chip.getAttribute('data-gcal-enhanced') || '';
    const allText = `${chip.innerText || ''} ${rawAria} ${ariaHidden} ${enhancedAttr}`;

    // 1. Type
    let type: 'EXAMEN' | 'ENTREGA' = 'EXAMEN';
    if (/calendario:\s*[^,]*ent[er]gra/i.test(allText) || /\[ENTREGA\]/i.test(allText) || /entrega|entegra|deadline|assignment|due|devoir/i.test(allText)) {
      type = 'ENTREGA';
    }

    // 2. Calendar destination
    const calMatch = allText.match(/(?:Calendario|Calendar):\s*([^,]+)/i);
    const calendar = calMatch ? calMatch[1].trim() : (type === 'ENTREGA' ? '🗓️ Entregas' : '📋 Exámenes');

    // 3. Time
    const timeMatch = allText.match(/(?:De|From)\s*(\d{1,2}:\d{2})\s*(?:a|to)\s*(\d{1,2}:\d{2})/i) ||
      allText.match(/(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})/i);
    let startTime = timeMatch ? timeMatch[1] : '';
    let endTime = timeMatch ? timeMatch[2] : '';

    if (!startTime) {
      const timeEl = chip.querySelector('.gVNoLb');
      const timeTxt = timeEl?.textContent || '';
      const m = timeTxt.match(/(\d{1,2}:\d{2})/);
      if (m) startTime = m[1];
    }
    if (!startTime) startTime = '09:00';
    if (!endTime) {
      const [h, m] = startTime.split(':').map(Number);
      endTime = `${String((h + 2) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // Calculate duration & parse date with multilingual dateParsers [P3-01]
    const [sh, sm] = startTime.split(':').map(Number);
    const durationStr = calculateDuration(startTime, endTime);

    // 4. Date
    const parsedDate = parseAcademicDateString(allText, sh, sm);
    const dateStr = parsedDate.dateStr;
    const isoDate = parsedDate.isoDate;
    const eventDate = parsedDate.eventDate;

    // 5. Title & Subject
    const titleSpan = chip.querySelector('.I0UMhf');
    const rawTitle = titleSpan ? (titleSpan.textContent || '').trim() : '';
    let subject = '';
    let title = rawTitle;

    const m = rawTitle.match(/^\[?(EXAMEN|ENTREGA)\]?\s*[:-]?\s*(.*?)\s*[-·–]\s*(.+)$/i);
    if (m) {
      subject = m[2].trim();
      title = m[3].trim();
    } else {
      const m2 = rawTitle.match(/^\[?(EXAMEN|ENTREGA)\]?\s*(.+)$/i);
      if (m2) {
        title = m2[1].trim();
      }
    }

    // Fallback: If subject or title not extracted from rawTitle, check full aria text pattern
    if (!subject || !title) {
      const matchAll = allText.match(/\[?(EXAMEN|ENTREGA)\]?\s*[:-]?\s*([^\n\r,–-]+?)\s*[-·–]\s*([^\n\r,]+)/i);
      if (matchAll) {
        if (!subject) subject = matchAll[2].trim();
        if (!title) title = matchAll[3].trim();
      }
    }
    if (!title && chip.innerText && typeof chip.innerText === 'string' && chip.innerText.trim()) {
      title = chip.innerText.trim();
    }

    if (!subject) {
      const cleanAll = adapter.normalizeStr(allText);
      for (const cls of adapter.getDetectedClasses()) {
        const cleanCls = adapter.normalizeStr(cls);
        if (cleanCls && cleanAll.includes(cleanCls)) {
          subject = cls;
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
    if (!title) title = 'Evento Académico';

    // 6. Cached description from isolated storage or allText [P0-03]
    let description = '';
    try {
      const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
      const cleanKey = title.toLowerCase().trim();
      const fullKey = `${cleanKey}_${subject.toLowerCase().trim()}`;
      description = meta[fullKey]?.description || meta[cleanKey]?.description || '';
    } catch (_) {}

    // Fallback: If not in storage, look for explicit description/notas in chip text
    if (!description) {
      const descMatch = allText.match(/(?:descripci[oó]n|notas?):\s*([^\n,]+)/i);
      if (descMatch && !/sin ubicaci|ubicaci[oó]n/i.test(descMatch[1])) {
        description = descMatch[1].trim();
      }
    }

    // Clean up if description contains location artifact
    if (description && (/sin ubicaci/i.test(description) || /^ubicaci[oó]n/i.test(description))) {
      description = '';
    }

    // 7. Countdown & Status
    let countdownStr = 'Programado';
    let countdownStatus: 'urgent' | 'today' | 'upcoming' | 'past' = 'upcoming';
    if (eventDate) {
      const now = new Date();
      const msDiff = eventDate.getTime() - now.getTime();
      const hoursDiff = msDiff / (1000 * 60 * 60);

      if (msDiff < 0) {
        countdownStr = '✓ Finalizado';
        countdownStatus = 'past';
      } else if (hoursDiff < 2) {
        const minsLeft = Math.max(1, Math.round(msDiff / (1000 * 60)));
        countdownStr = `🚨 ¡En ${minsLeft} min!`;
        countdownStatus = 'urgent';
      } else if (hoursDiff < 24 && eventDate.getDate() === now.getDate()) {
        const hLeft = Math.floor(hoursDiff);
        countdownStr = `🔥 ¡Hoy! (En ${hLeft}h)`;
        countdownStatus = 'today';
      } else if (hoursDiff < 48) {
        countdownStr = `⏳ Mañana a las ${startTime}`;
        countdownStatus = 'upcoming';
      } else {
        const daysLeft = Math.ceil(hoursDiff / 24);
        countdownStr = `⏳ En ${daysLeft} días`;
        countdownStatus = 'upcoming';
      }
    }

    // 8. Subject color
    const subjectColor = adapter.findSubjectColor(subject, colorMap);

    // 9. Event ID
    let rawEventId = (typeof chip.getAttribute === 'function' ? chip.getAttribute('data-eventid') : '') ||
      (typeof chip.querySelector === 'function' ? chip.querySelector('[data-eventid]')?.getAttribute('data-eventid') : '') ||
      (typeof chip.closest === 'function' ? chip.closest('[data-eventid]')?.getAttribute('data-eventid') : '') || '';

    if (!rawEventId && typeof chip.getAttribute === 'function') {
      const jslog = chip.getAttribute('jslog') || '';
      const mLog = jslog.match(/2:\["([^"]+)"/);
      if (mLog) rawEventId = mLog[1];
    }
    const eventId = rawEventId.split(' ')[0] || rawEventId;

    // 10. Completed status
    let isCompleted = false;
    try {
      const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
      const cleanKey = title.toLowerCase().trim();
      const fullKey = `${cleanKey}_${subject.toLowerCase().trim()}`;
      if (meta[eventId]?.completed || meta[fullKey]?.completed || meta[cleanKey]?.completed) {
        isCompleted = true;
      }
    } catch (_) {}

    return {
      type,
      subject,
      title,
      description,
      dateStr,
      isoDate,
      startTime,
      endTime,
      durationStr,
      countdownStr,
      countdownStatus,
      calendar,
      subjectColor,
      eventId,
      chipElement: chip,
      isCompleted
    };
  }

  private ensureAnimationStyles(): void {
    const animStyleId = 'gcal-detail-modal-anim-styles';
    if (!document.getElementById(animStyleId)) {
      const st = document.createElement('style');
      st.id = animStyleId;
      st.textContent = `
        @keyframes gcalDetailFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes gcalDetailScaleUp {
          from { opacity: 0; transform: scale(0.94) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .gcal-detail-pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          animation: gcalPulse 1.8s infinite;
        }
        @keyframes gcalPulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.25); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
      `;
      document.head.appendChild(st);
    }
  }

  private getStatusPillColors(countdownStatus: string): { statusBg: string; statusColor: string; statusBorder: string; pulseColor: string } {
    let statusBg = 'rgba(26, 115, 232, 0.12)';
    let statusColor = '#1a73e8';
    let statusBorder = 'rgba(26, 115, 232, 0.25)';
    let pulseColor = '#1a73e8';

    if (countdownStatus === 'urgent') {
      statusBg = 'rgba(217, 48, 37, 0.14)';
      statusColor = '#d93025';
      statusBorder = 'rgba(217, 48, 37, 0.35)';
      pulseColor = '#d93025';
    } else if (countdownStatus === 'today') {
      statusBg = 'rgba(232, 113, 10, 0.14)';
      statusColor = '#e8710a';
      statusBorder = 'rgba(232, 113, 10, 0.35)';
      pulseColor = '#e8710a';
    } else if (countdownStatus === 'past') {
      statusBg = 'rgba(128, 134, 139, 0.14)';
      statusColor = '#80868b';
      statusBorder = 'rgba(128, 134, 139, 0.25)';
      pulseColor = '#80868b';
    }

    return { statusBg, statusColor, statusBorder, pulseColor };
  }

  private renderHeaderRow(detail: AcademicEventDetail, isEntrega: boolean, typeLabel: string): string {
    return `
      <!-- Top Row: Type Pill, Calendar Destination & Close Button -->
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <!-- Type Pill -->
          <span style="
            background: ${isEntrega ? 'rgba(0, 0, 0, 0.08)' : detail.subjectColor};
            color: ${isEntrega ? '#000000' : '#ffffff'};
            border: ${isEntrega ? `2px solid ${detail.subjectColor}` : 'none'};
            padding: 5px 12px;
            border-radius: 9px;
            font-size: 11.5px;
            font-weight: 700;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: ${isEntrega ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.25)'};
          ">
            ${typeLabel}
          </span>

          ${isEntrega && detail.isCompleted ? `
            <!-- Modo Oculto Badge -->
            <span style="
              background: rgba(52, 168, 83, 0.15);
              border: 1px solid rgba(52, 168, 83, 0.45);
              color: #34a853;
              padding: 5px 12px;
              border-radius: 9px;
              font-size: 11px;
              font-weight: 700;
              display: flex;
              align-items: center;
              gap: 5px;
              letter-spacing: 0.4px;
            ">
              <span>👻</span> <span>MODO OCULTO (HECHA)</span>
            </span>
          ` : ''}

          <!-- Calendar Destination Tag -->
          <span style="
            font-size: 11.5px;
            color: var(--gcal-secondary-text, #5f6368);
            background: var(--gcal-surface-hover, #f1f3f4);
            padding: 5px 12px;
            border-radius: 9px;
            font-weight: 600;
            border: 1px solid var(--gcal-border, #dadce0);
            display: flex;
            align-items: center;
            gap: 5px;
          ">
            <span>📁</span> ${escapeHtml(detail.calendar)}
          </span>
        </div>

        <!-- Close Button -->
        <button id="gcal-detail-close-btn" type="button" aria-label="Cerrar" style="
          background: transparent;
          border: 1px solid transparent;
          color: var(--gcal-secondary-text, #5f6368);
          font-size: 17px;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        " onmouseover="this.style.background='var(--gcal-surface-hover, #f1f3f4)'; this.style.borderColor='var(--gcal-border, #dadce0)'; this.style.color='var(--gcal-text, #1f1f1f)'" onmouseout="this.style.background='transparent'; this.style.borderColor='transparent'; this.style.color='var(--gcal-secondary-text, #5f6368)'">
          ✕
        </button>
      </div>
    `;
  }

  private renderSubjectAndTitle(detail: AcademicEventDetail): string {
    return `
      <!-- Subject Tag Banner -->
      <div style="
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: var(--gcal-surface-hover, #f8f9fa);
        border: 1px solid var(--gcal-border, #dadce0);
        border-left: 4.5px solid ${detail.subjectColor};
        padding: 6px 14px;
        border-radius: 8px;
        width: fit-content;
      ">
        <span style="font-size: 13px; font-weight: 700; color: var(--gcal-text, #1f1f1f); letter-spacing: 0.4px;">
          ${escapeHtml(detail.subject)}
        </span>
      </div>

      <!-- Title Protagonista -->
      <div style="
        font-size: 25px;
        font-weight: 800;
        color: var(--gcal-text, #1f1f1f);
        line-height: 1.25;
        letter-spacing: -0.4px;
        word-break: break-word;
        ${detail.isCompleted ? 'text-decoration: line-through; opacity: 0.75;' : ''}
      ">
        ${escapeHtml(detail.title)}
      </div>
    `;
  }

  private renderBentoGrid(detail: AcademicEventDetail, status: { statusBg: string; statusColor: string; statusBorder: string; pulseColor: string }): string {
    return `
      <!-- Bento Grid: Fecha, Horario, Cuenta Atrás -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
        
        <!-- Bento 1: Fecha (Interactivo) -->
        <div id="gcal-detail-bento-date" title="Haz clic para mover este evento a otra fecha" style="
          background: var(--gcal-surface-hover, #f8f9fa);
          border: 1px solid var(--gcal-border, #dadce0);
          border-radius: 14px;
          padding: 13px 15px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: all 0.15s ease;
        " onmouseover="this.style.borderColor='var(--gcal-accent, #1a73e8)'; this.style.boxShadow='0 2px 8px rgba(26, 115, 232, 0.18)';" onmouseout="this.style.borderColor='var(--gcal-border, #dadce0)'; this.style.boxShadow='0 1px 3px rgba(0, 0, 0, 0.04)';">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 10.5px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.6px; display: flex; align-items: center; gap: 5px;">
              <span>📅</span> FECHA
            </span>
            <span style="font-size: 10px; font-weight: 700; color: var(--gcal-accent, #1a73e8); background: rgba(26, 115, 232, 0.1); padding: 2px 6px; border-radius: 6px;">✏️ Mover</span>
          </div>
          <span style="font-size: 13.5px; font-weight: 700; color: var(--gcal-text, #1f1f1f); line-height: 1.35; margin-top: 2px;">
            ${escapeHtml(detail.dateStr)}
          </span>
        </div>

        <!-- Bento 2: Horario y Duración (Interactivo) -->
        <div id="gcal-detail-bento-time" title="Haz clic para cambiar horario o duración" style="
          background: var(--gcal-surface-hover, #f8f9fa);
          border: 1px solid var(--gcal-border, #dadce0);
          border-radius: 14px;
          padding: 13px 15px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: all 0.15s ease;
        " onmouseover="this.style.borderColor='var(--gcal-accent, #1a73e8)'; this.style.boxShadow='0 2px 8px rgba(26, 115, 232, 0.18)';" onmouseout="this.style.borderColor='var(--gcal-border, #dadce0)'; this.style.boxShadow='0 1px 3px rgba(0, 0, 0, 0.04)';">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 10.5px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.6px; display: flex; align-items: center; gap: 5px;">
              <span>⏱️</span> HORARIO
            </span>
            <span style="font-size: 10px; font-weight: 700; color: var(--gcal-accent, #1a73e8); background: rgba(26, 115, 232, 0.1); padding: 2px 6px; border-radius: 6px;">✏️ Cambiar</span>
          </div>
          <span style="font-size: 13.5px; font-weight: 700; color: var(--gcal-text, #1f1f1f); line-height: 1.35; margin-top: 2px;">
            ${escapeHtml(detail.startTime)} – ${escapeHtml(detail.endTime)}
          </span>
          <span style="font-size: 11px; font-weight: 600; color: var(--gcal-secondary-text, #5f6368);">
            ${escapeHtml(detail.durationStr)}
          </span>
        </div>

        <!-- Bento 3: Estado / Cuenta Atrás -->
        <div style="
          background: ${detail.isCompleted ? 'rgba(52, 168, 83, 0.12)' : status.statusBg};
          border: 1px solid ${detail.isCompleted ? 'rgba(52, 168, 83, 0.35)' : status.statusBorder};
          border-radius: 14px;
          padding: 13px 15px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        ">
          <span style="font-size: 10.5px; font-weight: 700; color: ${detail.isCompleted ? '#34a853' : status.statusColor}; text-transform: uppercase; letter-spacing: 0.6px; display: flex; align-items: center; gap: 6px;">
            <span class="gcal-detail-pulse-dot" style="background: ${detail.isCompleted ? '#34a853' : status.pulseColor};"></span>
            ESTADO
          </span>
          <span style="font-size: 13.5px; font-weight: 800; color: ${detail.isCompleted ? '#34a853' : status.statusColor}; line-height: 1.35; margin-top: 2px;">
            ${detail.isCompleted ? '✅ Realizada' : escapeHtml(detail.countdownStr)}
          </span>
          <span style="font-size: 11px; font-weight: 600; color: ${detail.isCompleted ? '#34a853' : 'var(--gcal-secondary-text, #5f6368)'};">
            ${detail.isCompleted ? 'Modo oculto (baja opacidad)' : ''}
          </span>
        </div>

      </div>
    `;
  }

  private renderReschedulePanel(): string {
    return `
      <!-- Panel Desplegable: Mover Fecha y Horario -->
      <div id="gcal-detail-reschedule-panel" style="
        display: ${this.isRescheduling ? 'flex' : 'none'};
        flex-direction: column;
        gap: 12px;
        background: var(--gcal-surface-hover, #f8f9fa);
        border: 1.5px solid var(--gcal-accent, #1a73e8);
        padding: 16px;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(26, 115, 232, 0.12);
        animation: gcalDetailFadeIn 0.2s ease;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">📅</span>
            <span style="font-size: 13.5px; font-weight: 800; color: var(--gcal-text, #1f1f1f);">
              Mover Evento a Otra Fecha / Horario
            </span>
          </div>
          <button id="gcal-reschedule-btn-close-panel" type="button" aria-label="Cerrar panel de mover" style="
            background: transparent;
            border: none;
            font-size: 16px;
            cursor: pointer;
            color: var(--gcal-secondary-text, #5f6368);
            padding: 4px;
            border-radius: 50%;
          ">✕</button>
        </div>

        <!-- Atajos rápidos -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <span style="font-size: 11px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase; letter-spacing: 0.5px;">Atajos de Fecha:</span>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="gcal-reschedule-preset-btn" data-days="1" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 5px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer; transition: all 0.15s ease;">+1 día (Mañana)</button>
            <button type="button" class="gcal-reschedule-preset-btn" data-days="2" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 5px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer; transition: all 0.15s ease;">+2 días</button>
            <button type="button" class="gcal-reschedule-preset-btn" data-days="7" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 5px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer; transition: all 0.15s ease;">+1 semana</button>
            <button type="button" class="gcal-reschedule-preset-btn" data-days="14" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 5px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer; transition: all 0.15s ease;">+2 semanas</button>
          </div>
        </div>

        <!-- Mini Calendario Visual -->
        <div style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <button id="gcal-reschedule-cal-prev" type="button" aria-label="Mes anterior" style="background: transparent; border: 1px solid var(--gcal-border, #dadce0); border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; color: var(--gcal-text, #1f1f1f);">‹</button>
            <span id="gcal-reschedule-cal-month-title" style="font-size: 12.5px; font-weight: 700; color: var(--gcal-text, #1f1f1f);">...</span>
            <button id="gcal-reschedule-cal-next" type="button" aria-label="Mes siguiente" style="background: transparent; border: 1px solid var(--gcal-border, #dadce0); border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; color: var(--gcal-text, #1f1f1f);">›</button>
          </div>

          <!-- Días semana L M X J V S D -->
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 10.5px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368);">
            <span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span>
          </div>

          <!-- Grid de días -->
          <div id="gcal-reschedule-calendar-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px;"></div>
        </div>

        <!-- Horarios y Duración -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="gcal-reschedule-input-start" style="font-size: 11px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase;">Hora Inicio</label>
            <input id="gcal-reschedule-input-start" type="time" value="${this.rescheduleStartTime}" style="padding: 7px 10px; border: 1px solid var(--gcal-border, #dadce0); border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--gcal-text, #1f1f1f); background: var(--gcal-surface, #ffffff); outline: none;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label for="gcal-reschedule-input-end" style="font-size: 11px; font-weight: 700; color: var(--gcal-secondary-text, #5f6368); text-transform: uppercase;">Hora Fin</label>
            <input id="gcal-reschedule-input-end" type="time" value="${this.rescheduleEndTime}" style="padding: 7px 10px; border: 1px solid var(--gcal-border, #dadce0); border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--gcal-text, #1f1f1f); background: var(--gcal-surface, #ffffff); outline: none;">
          </div>
        </div>

        <!-- Chips de duración rápida -->
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span style="font-size: 11px; font-weight: 600; color: var(--gcal-secondary-text, #5f6368);">Duración rápida:</span>
          <button type="button" class="gcal-reschedule-dur-btn" data-hours="1" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 4px 9px; border-radius: 7px; font-size: 11px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer;">1h</button>
          <button type="button" class="gcal-reschedule-dur-btn" data-hours="1.5" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 4px 9px; border-radius: 7px; font-size: 11px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer;">1.5h</button>
          <button type="button" class="gcal-reschedule-dur-btn" data-hours="2" style="background: var(--gcal-surface, #ffffff); border: 1px solid var(--gcal-border, #dadce0); padding: 4px 9px; border-radius: 7px; font-size: 11px; font-weight: 600; color: var(--gcal-text, #1f1f1f); cursor: pointer;">2h</button>
          <button type="button" class="gcal-reschedule-dur-btn" data-special="endofday" style="background: rgba(234, 67, 53, 0.08); border: 1px solid rgba(234, 67, 53, 0.3); padding: 4px 9px; border-radius: 7px; font-size: 11px; font-weight: 700; color: #d93025; cursor: pointer;">23:59 (Fin de día)</button>
        </div>

        <!-- Resumen de cambio -->
        <div id="gcal-reschedule-summary" style="background: rgba(26, 115, 232, 0.06); border: 1px dashed rgba(26, 115, 232, 0.35); border-radius: 10px; padding: 10px 14px; font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
        </div>

        <!-- Acciones del Panel -->
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
          <button id="gcal-reschedule-btn-cancel" type="button" style="
            background: transparent;
            border: 1px solid var(--gcal-border, #dadce0);
            padding: 7px 15px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            color: var(--gcal-text, #1f1f1f);
          ">Cancelar</button>
          <button id="gcal-reschedule-btn-confirm" type="button" style="
            background: var(--gcal-accent, #1a73e8);
            color: #ffffff;
            border: none;
            padding: 7px 18px;
            border-radius: 8px;
            font-size: 12.5px;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 6px rgba(26, 115, 232, 0.35);
            transition: all 0.15s ease;
          ">
            <span>🚀 Confirmar y Mover</span>
          </button>
        </div>
      </div>
    `;
  }

  private renderNotesSection(detail: AcademicEventDetail): string {
    return `
      <!-- Sección Central: Notas y Temario (Rediseñada y más bonita) -->
      <div style="
        background: var(--gcal-surface-hover, #f8f9fa);
        border: 1px solid var(--gcal-border, #dadce0);
        border-radius: 14px;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      ">
        <!-- Header de Notas -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">📝</span>
            <span style="font-size: 13px; font-weight: 700; color: var(--gcal-text, #1f1f1f); letter-spacing: 0.3px;">
              Notas, Temario y Enlaces
            </span>
          </div>

          <button id="gcal-detail-toggle-edit-notes" type="button" style="
            background: transparent;
            border: 1px solid var(--gcal-border, #dadce0);
            color: var(--gcal-accent, #1a73e8);
            font-size: 12px;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s ease;
            display: flex;
            align-items: center;
            gap: 5px;
          " onmouseover="this.style.background='rgba(26, 115, 232, 0.08)'" onmouseout="this.style.background='transparent'">
            ${this.isEditingNotes ? '✕ Cancelar' : (detail.description ? '✏️ Editar notas' : '+ Añadir notas')}
          </button>
        </div>

        <!-- View Mode (Cuando hay notas) -->
        <div id="gcal-detail-notes-view" style="
          display: ${this.isEditingNotes ? 'none' : 'block'};
          font-size: 13.5px;
          color: ${detail.description ? 'var(--gcal-text, #1f1f1f)' : 'var(--gcal-secondary-text, #5f6368)'};
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          ${detail.description ? `background: var(--gcal-surface, #ffffff); border-left: 3.5px solid ${detail.subjectColor}; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--gcal-border, #dadce0); border-left: 3.5px solid ${detail.subjectColor};` : 'padding: 8px 4px; font-style: italic;'}
        ">
          ${escapeHtml(detail.description) || 'Sin notas o temario registrado para este evento. Pulsa en "+ Añadir notas" para incluir temas de examen, enlaces del campus virtual o recordatorios.'}
        </div>

        <!-- Edit Mode (Editor con textarea estilizado) -->
        <div id="gcal-detail-notes-edit" style="display: ${this.isEditingNotes ? 'flex' : 'none'}; flex-direction: column; gap: 10px;">
          <textarea id="gcal-detail-notes-input" style="
            width: 100%;
            min-height: 95px;
            border: 1.5px solid var(--gcal-accent, #1a73e8);
            border-radius: 10px;
            background: var(--gcal-surface, #ffffff);
            color: var(--gcal-text, #1f1f1f);
            padding: 10px 12px;
            font-size: 13px;
            line-height: 1.5;
            font-family: inherit;
            resize: vertical;
            box-sizing: border-box;
            outline: none;
            box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.15);
          " placeholder="Escribe aquí los temas del examen, enlaces al campus virtual, formato de entrega...">${escapeHtml(detail.description)}</textarea>
          
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button id="gcal-detail-save-notes-btn" type="button" style="
              background: var(--gcal-accent, #1a73e8);
              color: #ffffff;
              border: none;
              border-radius: 8px;
              padding: 7px 16px;
              font-size: 12.5px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 6px;
              box-shadow: 0 2px 6px rgba(26, 115, 232, 0.35);
              transition: all 0.15s ease;
            " onmouseover="this.style.background='#1557b0'" onmouseout="this.style.background='var(--gcal-accent, #1a73e8)'">
              <span>💾</span> <span>Guardar notas</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderCompletePanel(): string {
    return `
      <!-- Panel de Opciones de Finalización (Entregas) -->
      <div id="gcal-detail-complete-panel" style="
        display: ${this.isCompletePanelOpen ? 'flex' : 'none'};
        flex-direction: column;
        gap: 8px;
        background: var(--gcal-surface-hover, rgba(52, 168, 83, 0.08));
        border: 1px solid rgba(52, 168, 83, 0.35);
        padding: 12px 16px;
        border-radius: 14px;
        animation: gcalDetailFadeIn 0.2s ease;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 20px;">🎉</span>
            <div>
              <div style="font-size: 14px; font-weight: 800; color: var(--gcal-text, #1f1f1f);">
                Marcar Entrega como Realizada
              </div>
              <div style="font-size: 11.5px; color: var(--gcal-secondary-text, #5f6368);">
                ¿Cómo prefieres gestionar esta entrega terminada?
              </div>
            </div>
          </div>
          <button id="gcal-detail-close-complete-panel" type="button" aria-label="Cerrar opciones" style="
            background: transparent;
            border: none;
            font-size: 16px;
            cursor: pointer;
            color: var(--gcal-secondary-text, #5f6368);
            padding: 4px;
            border-radius: 50%;
          ">✕</button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px;">
          <!-- Opción 1: Dejar en modo oculto (Baja opacidad) -->
          <button id="gcal-detail-action-dim" type="button" style="
            background: var(--gcal-surface, #ffffff);
            border: 1.5px solid rgba(52, 168, 83, 0.4);
            border-radius: 12px;
            padding: 12px 14px;
            text-align: left;
            cursor: pointer;
            transition: all 0.15s ease;
            display: flex;
            flex-direction: column;
            gap: 5px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
          " onmouseover="this.style.borderColor='#34a853'; this.style.transform='translateY(-1px)'" onmouseout="this.style.borderColor='rgba(52, 168, 83, 0.4)'; this.style.transform='none'">
            <div style="font-size: 13px; font-weight: 800; color: #34a853; display: flex; align-items: center; gap: 6px;">
              <span>👻</span> <span>Dejar en modo oculto</span>
            </div>
            <div style="font-size: 11px; color: var(--gcal-secondary-text, #5f6368); line-height: 1.35;">
              Se verá en el calendario pero con muy poca opacidad (25%). Podrás devolverla a la normalidad cuando quieras.
            </div>
          </button>

          <!-- Opción 2: Quitar del todo -->
          <button id="gcal-detail-action-delete-all" type="button" style="
            background: var(--gcal-surface, #ffffff);
            border: 1.5px solid rgba(217, 48, 37, 0.4);
            border-radius: 12px;
            padding: 12px 14px;
            text-align: left;
            cursor: pointer;
            transition: all 0.15s ease;
            display: flex;
            flex-direction: column;
            gap: 5px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
          " onmouseover="this.style.borderColor='#d93025'; this.style.transform='translateY(-1px)'" onmouseout="this.style.borderColor='rgba(217, 48, 37, 0.4)'; this.style.transform='none'">
            <div style="font-size: 13px; font-weight: 800; color: #d93025; display: flex; align-items: center; gap: 6px;">
              <span>🗑️</span> <span>Quitar del todo</span>
            </div>
            <div style="font-size: 11px; color: var(--gcal-secondary-text, #5f6368); line-height: 1.35;">
              Se borrará definitivamente de Google Calendar y ya no aparecerá.
            </div>
          </button>
        </div>
      </div>
    `;
  }

  private renderDeleteConfirm(isEntrega: boolean, deleteButtonLabel: string): string {
    return `
      <!-- Confirmación de Eliminación Inline (si activa) -->
      <div id="gcal-detail-delete-confirm" style="
        display: ${this.isDeleting ? 'flex' : 'none'};
        flex-direction: column;
        gap: 12px;
        background: #fce8e6;
        border: 1px solid #fad2cf;
        padding: 14px 18px;
        border-radius: 14px;
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">⚠️</span>
          <span style="font-size: 13px; font-weight: 700; color: #d93025;">
            ¿Estás seguro de que quieres ${isEntrega ? 'quitar del todo este evento' : 'eliminar este evento'} de Google Calendar?
          </span>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button id="gcal-detail-cancel-delete" type="button" style="
            background: transparent;
            border: 1px solid #dadce0;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            color: #1f1f1f;
          ">Cancelar</button>
          <button id="gcal-detail-confirm-delete" type="button" style="
            background: #d93025;
            color: #ffffff;
            border: none;
            padding: 7px 16px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(217, 48, 37, 0.35);
          ">Sí, ${deleteButtonLabel}</button>
        </div>
      </div>
    `;
  }

  private renderToastContainer(): string {
    return `
      <!-- Toast Message Feedback -->
      <div id="gcal-detail-toast" style="
        display: none;
        font-size: 12.5px;
        font-weight: 600;
        color: #188038;
        background: #e6f4ea;
        border: 1px solid #ceead6;
        padding: 9px 14px;
        border-radius: 10px;
        text-align: center;
      "></div>
    `;
  }

  private renderFooterActions(detail: AcademicEventDetail, isEntrega: boolean, showDeleteButton: boolean, deleteButtonLabel: string): string {
    return `
      <!-- Bottom Actions Toolbar -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 4px;
        border-top: 1px solid var(--gcal-border, #dadce0);
        padding-top: 16px;
        gap: 12px;
        flex-wrap: wrap;
      ">
        <!-- Left: Quitar del todo / Eliminar (solo si no es entrega o ya está realizada) -->
        ${showDeleteButton ? `
          <button id="gcal-detail-btn-delete" type="button" style="
            background: transparent;
            border: 1px solid rgba(217, 48, 37, 0.35);
            color: #d93025;
            padding: 8px 16px;
            border-radius: 10px;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
          " onmouseover="this.style.background='#fce8e6'" onmouseout="this.style.background='transparent'">
            <span>🗑️</span> <span>${deleteButtonLabel}</span>
          </button>
        ` : '<div></div>'}

        <!-- Right: Mover fecha / hora + Marcar hecha / Restaurar + Editor completo + Cerrar -->
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button id="gcal-detail-btn-open-reschedule" type="button" style="
            background: rgba(26, 115, 232, 0.08);
            border: 1px solid rgba(26, 115, 232, 0.35);
            color: var(--gcal-accent, #1a73e8);
            padding: 8px 15px;
            border-radius: 10px;
            font-size: 12.5px;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
          " onmouseover="this.style.background='rgba(26, 115, 232, 0.18)'" onmouseout="this.style.background='rgba(26, 115, 232, 0.08)'">
            <span>📅</span> <span>Mover fecha / hora</span>
          </button>
          ${isEntrega ? `
            ${detail.isCompleted ? `
              <button id="gcal-detail-btn-restore" type="button" style="
                background: rgba(26, 115, 232, 0.12);
                border: 1px solid rgba(26, 115, 232, 0.45);
                color: #1a73e8;
                padding: 8px 16px;
                border-radius: 10px;
                font-size: 12.5px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.15s ease;
              " onmouseover="this.style.background='rgba(26, 115, 232, 0.22)'" onmouseout="this.style.background='rgba(26, 115, 232, 0.12)'">
                <span>↩️</span> <span>Devolver a la normalidad</span>
              </button>
            ` : `
              <button id="gcal-detail-btn-complete" type="button" style="
                background: rgba(52, 168, 83, 0.12);
                border: 1px solid rgba(52, 168, 83, 0.45);
                color: #34a853;
                padding: 8px 16px;
                border-radius: 10px;
                font-size: 12.5px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.15s ease;
              " onmouseover="this.style.background='rgba(52, 168, 83, 0.22)'" onmouseout="this.style.background='rgba(52, 168, 83, 0.12)'">
                <span>✅</span> <span>Marcar como realizada</span>
              </button>
            `}
          ` : ''}

          ${detail.eventId ? `
            <button id="gcal-detail-btn-google-edit" type="button" style="
              background: var(--gcal-surface-hover, #f1f3f4);
              border: 1px solid var(--gcal-border, #dadce0);
              color: var(--gcal-text, #1f1f1f);
              padding: 8px 16px;
              border-radius: 10px;
              font-size: 12.5px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 6px;
              transition: background 0.15s ease;
            " onmouseover="this.style.background='var(--gcal-surface, #ffffff)'" onmouseout="this.style.background='var(--gcal-surface-hover, #f1f3f4)'">
              <span>🔗</span> <span>Editor completo</span>
            </button>
          ` : ''}

          <button id="gcal-detail-btn-close" type="button" style="
            background: var(--gcal-accent, #1a73e8);
            color: #ffffff;
            border: none;
            padding: 8px 22px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 3px 8px rgba(26, 115, 232, 0.35);
            transition: all 0.15s ease;
          " onmouseover="this.style.background='#1557b0'" onmouseout="this.style.background='var(--gcal-accent, #1a73e8)'">
            Cerrar
          </button>
        </div>

      </div>
    `;
  }

  private render(): void {
    if (typeof document === 'undefined') return;
    if (!this.currentDetail) return;
    const detail = this.currentDetail;

    this.modalOverlay = document.createElement('div');
    this.modalOverlay.id = 'gcal-academic-detail-modal';
    this.modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(10, 15, 29, 0.72);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font-family: 'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      animation: gcalDetailFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    this.ensureAnimationStyles();

    const isEntrega = detail.type === 'ENTREGA';
    const typeLabel = isEntrega ? '🗓️ ENTREGA / PRÁCTICA' : '📋 EXAMEN OFICIAL';
    const showDeleteButton = !isEntrega || detail.isCompleted;
    const deleteButtonLabel = isEntrega ? 'Quitar del todo' : 'Eliminar';
    const statusColors = this.getStatusPillColors(detail.countdownStatus);

    safeSetInnerHTML(
      this.modalOverlay,
      `
      <div id="gcal-detail-card" style="
        position: relative;
        z-index: 10;
        background: var(--gcal-surface, #ffffff);
        color: var(--gcal-text, #1f1f1f);
        border: 1px solid var(--gcal-border, rgba(255, 255, 255, 0.12));
        border-radius: 24px;
        width: 620px;
        max-width: 94vw;
        max-height: 94vh;
        overflow-y: auto;
        box-shadow: 0 32px 80px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        animation: gcalDetailScaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        box-sizing: border-box;
      ">
        <div style="height: 6px; width: 100%; background: ${detail.subjectColor}; box-shadow: 0 1px 12px ${detail.subjectColor}66;"></div>
        <div style="padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;">
          ${this.renderHeaderRow(detail, isEntrega, typeLabel)}
          ${this.renderSubjectAndTitle(detail)}
          ${this.renderBentoGrid(detail, statusColors)}
          ${this.renderReschedulePanel()}
          ${this.renderNotesSection(detail)}
          ${this.renderCompletePanel()}
          ${this.renderDeleteConfirm(isEntrega, deleteButtonLabel)}
          ${this.renderToastContainer()}
          ${this.renderFooterActions(detail, isEntrega, showDeleteButton, deleteButtonLabel)}
        </div>
      </div>
    `
    );

    document.body.appendChild(this.modalOverlay);
    this.focusTrapCleanup = setupFocusTrap(this.modalOverlay);
    this.setupListeners();
  }

  private setupListeners(): void {
    if (!this.modalOverlay || !this.currentDetail) return;
    const detail = this.currentDetail;

    // Close handlers
    const closeBtn = this.modalOverlay.querySelector('#gcal-detail-close-btn');
    const bottomCloseBtn = this.modalOverlay.querySelector('#gcal-detail-btn-close');

    closeBtn?.addEventListener('click', () => this.close());
    bottomCloseBtn?.addEventListener('click', () => this.close());

    // Click on backdrop to close
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) {
        this.close();
      }
    });

    // ESC key handler (properly tracked and cleaned up on close)
    if (this.escHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.escHandler);
    }
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    window.addEventListener('keydown', this.escHandler);

    // Notes editing toggle
    const toggleNotesBtn = this.modalOverlay.querySelector('#gcal-detail-toggle-edit-notes');
    const notesView = this.modalOverlay.querySelector('#gcal-detail-notes-view') as HTMLElement;
    const notesEdit = this.modalOverlay.querySelector('#gcal-detail-notes-edit') as HTMLElement;
    const notesInput = this.modalOverlay.querySelector('#gcal-detail-notes-input') as HTMLTextAreaElement;
    const saveNotesBtn = this.modalOverlay.querySelector('#gcal-detail-save-notes-btn');

    toggleNotesBtn?.addEventListener('click', () => {
      this.isEditingNotes = !this.isEditingNotes;
      if (notesView) notesView.style.display = this.isEditingNotes ? 'none' : 'block';
      if (notesEdit) notesEdit.style.display = this.isEditingNotes ? 'flex' : 'none';
      if (toggleNotesBtn) {
        toggleNotesBtn.textContent = this.isEditingNotes ? '✕ Cancelar' : (detail.description ? '✏️ Editar notas' : '+ Añadir notas');
      }
      if (this.isEditingNotes && notesInput) {
        notesInput.focus();
      }
    });

    // Save notes
    saveNotesBtn?.addEventListener('click', () => {
      if (!notesInput) return;
      const newNotes = notesInput.value.trim();
      detail.description = newNotes;

      try {
        const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
        const cleanKey = detail.title.toLowerCase().trim();
        const fullKey = `${cleanKey}_${detail.subject.toLowerCase().trim()}`;
        meta[cleanKey] = { description: newNotes, subject: detail.subject, type: detail.type };
        meta[fullKey] = { description: newNotes, subject: detail.subject, type: detail.type };
        setIsolatedItem('gcal_academic_meta', JSON.stringify(meta));
      } catch (_) {}

      // Cloud description sync [P2-01]
      const desktopApi = (typeof window !== 'undefined' ? (window as any).gcalDesktopAPI : null);
      if (desktopApi && typeof desktopApi.updateEventDescriptionBackground === 'function' && detail.eventId) {
        desktopApi.updateEventDescriptionBackground({
          eventId: detail.eventId,
          eventTitle: detail.title,
          description: newNotes
        }).catch(() => {});
      }

      // Refresh chips on calendar grid
      GoogleCalendarAdapter.getInstance().enhanceAcademicChips();

      // Update view
      if (notesView) {
        if (newNotes) {
          notesView.textContent = newNotes;
          notesView.style.color = 'var(--gcal-text, #1f1f1f)';
          notesView.style.fontStyle = 'normal';
          notesView.style.background = 'var(--gcal-surface, #ffffff)';
          notesView.style.border = '1px solid var(--gcal-border, #dadce0)';
          notesView.style.borderLeft = `3.5px solid ${detail.subjectColor}`;
          notesView.style.padding = '12px 14px';
          notesView.style.borderRadius = '10px';
        } else {
          notesView.textContent = 'Sin notas o temario registrado para este evento. Pulsa en "+ Añadir notas" para incluir temas de examen, enlaces del campus virtual o recordatorios.';
          notesView.style.color = 'var(--gcal-secondary-text, #5f6368)';
          notesView.style.fontStyle = 'italic';
          notesView.style.background = 'transparent';
          notesView.style.border = 'none';
          notesView.style.padding = '8px 4px';
        }
        notesView.style.display = 'block';
      }
      if (notesEdit) notesEdit.style.display = 'none';
      this.isEditingNotes = false;
      if (toggleNotesBtn) toggleNotesBtn.textContent = newNotes ? '✏️ Editar notas' : '+ Añadir notas';

      this.showToast('✓ Notas guardadas correctamente');
    });

    // Delete flow
    const isEntrega = detail.type === 'ENTREGA';
    const deleteButtonLabel = isEntrega ? 'Quitar del todo' : 'Eliminar';
    const deleteBtn = this.modalOverlay.querySelector('#gcal-detail-btn-delete') as HTMLElement;
    const deleteConfirmBox = this.modalOverlay.querySelector('#gcal-detail-delete-confirm') as HTMLElement;
    const cancelDeleteBtn = this.modalOverlay.querySelector('#gcal-detail-cancel-delete');
    const confirmDeleteBtn = this.modalOverlay.querySelector('#gcal-detail-confirm-delete') as HTMLButtonElement;

    deleteBtn?.addEventListener('click', () => {
      this.isDeleting = true;
      if (deleteConfirmBox) deleteConfirmBox.style.display = 'flex';
      deleteConfirmBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    cancelDeleteBtn?.addEventListener('click', () => {
      this.isDeleting = false;
      if (deleteConfirmBox) deleteConfirmBox.style.display = 'none';
    });

    confirmDeleteBtn?.addEventListener('click', async () => {
      confirmDeleteBtn.disabled = true;
      confirmDeleteBtn.textContent = 'Eliminando...';

      try {
        if (!detail.eventId) {
          throw new Error('No se pudo identificar el ID del evento para eliminarlo en Google Calendar');
        }

        const desktopApi = (typeof window !== 'undefined' ? (window as any).gcalDesktopAPI : null);
        let res: any = null;
        if (desktopApi && typeof desktopApi.deleteAcademicEventBackground === 'function') {
          res = await desktopApi.deleteAcademicEventBackground(detail.eventId);
        } else {
          // Direct fallback for testing or mock environments
          res = { success: true };
        }

        if (res && res.success === false) {
          throw new Error(res.error || 'Error al eliminar el evento de Google Calendar');
        }

        // Clean local storage cache
        try {
          const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
          const cleanKey = detail.title.toLowerCase().trim();
          const fullKey = `${cleanKey}_${detail.subject.toLowerCase().trim()}`;
          delete meta[cleanKey];
          delete meta[fullKey];
          if (detail.eventId) {
            delete meta[detail.eventId];
          }
          setIsolatedItem('gcal_academic_meta', JSON.stringify(meta));
        } catch (_) {}

        // Mark event deleted in adapter (registers ID, adds permanent CSS suppression rule, purges all matching DOM chips)
        if (detail.eventId) {
          GoogleCalendarAdapter.getInstance().markEventDeleted(detail.eventId, detail.title, detail.subject);
        }

        // Remove chip from view
        if (detail.chipElement) {
          detail.chipElement.style.transition = 'opacity 0.25s ease';
          detail.chipElement.style.opacity = '0';
          setTimeout(() => detail.chipElement.remove(), 250);
        }

        // Trigger Google Calendar grid refresh
        GoogleCalendarAdapter.getInstance().triggerGridRefresh();

        this.showToast('✓ Evento eliminado de Google Calendar');
        setTimeout(() => this.close(), 700);
      } catch (err: any) {
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = `Sí, ${deleteButtonLabel}`;
        if (deleteConfirmBox) {
          safeSetInnerHTML(
            deleteConfirmBox,
            `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
              <span style="color: #d93025; font-size: 12px; font-weight: 600;">${escapeHtml(err?.message || 'Error al eliminar el evento.')}</span>
              <div style="display: flex; gap: 8px; margin-top: 4px;">
                <button id="gcal-detail-retry-delete" type="button" style="background: #d93025; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 600;">Reintentar</button>
                <button id="gcal-detail-err-cancel-delete" type="button" style="background: transparent; color: inherit; border: 1px solid rgba(0,0,0,0.2); padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;">Cerrar</button>
              </div>
            </div>
          `
          );
          deleteConfirmBox.querySelector('#gcal-detail-retry-delete')?.addEventListener('click', () => {
            confirmDeleteBtn.click();
          });
          deleteConfirmBox.querySelector('#gcal-detail-err-cancel-delete')?.addEventListener('click', () => {
            deleteConfirmBox.style.display = 'none';
          });
        }
      }
    });

    // Complete & Restore handlers (Entregas)
    const completeBtn = this.modalOverlay.querySelector('#gcal-detail-btn-complete');
    const completePanel = this.modalOverlay.querySelector('#gcal-detail-complete-panel') as HTMLElement;
    const closeCompletePanelBtn = this.modalOverlay.querySelector('#gcal-detail-close-complete-panel');
    const actionDimBtn = this.modalOverlay.querySelector('#gcal-detail-action-dim');
    const actionDeleteAllBtn = this.modalOverlay.querySelector('#gcal-detail-action-delete-all');
    const restoreBtn = this.modalOverlay.querySelector('#gcal-detail-btn-restore');

    completeBtn?.addEventListener('click', () => {
      this.isCompletePanelOpen = !this.isCompletePanelOpen;
      if (completePanel) {
        completePanel.style.display = this.isCompletePanelOpen ? 'flex' : 'none';
        if (this.isCompletePanelOpen) {
          completePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
      if (deleteConfirmBox) {
        deleteConfirmBox.style.display = 'none';
        this.isDeleting = false;
      }
    });

    closeCompletePanelBtn?.addEventListener('click', () => {
      this.isCompletePanelOpen = false;
      if (completePanel) completePanel.style.display = 'none';
    });

    actionDimBtn?.addEventListener('click', () => {
      this.setCompletionState(true, 'dimmed');
    });

    actionDeleteAllBtn?.addEventListener('click', () => {
      this.isCompletePanelOpen = false;
      if (completePanel) completePanel.style.display = 'none';
      this.isDeleting = true;
      if (deleteConfirmBox) {
        deleteConfirmBox.style.display = 'flex';
        deleteConfirmBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    restoreBtn?.addEventListener('click', () => {
      this.setCompletionState(false);
    });

    // Google Calendar full edit view
    const googleEditBtn = this.modalOverlay.querySelector('#gcal-detail-btn-google-edit');
    googleEditBtn?.addEventListener('click', () => {
      if (detail.eventId) {
        this.close();
        const match = (typeof window !== 'undefined' ? window.location.pathname : '').match(/\/u\/(\d+)/);
        const accountIndex = match ? match[1] : '0';
        window.location.href = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${detail.eventId}`;
      }
    });

    // Rescheduling panel handlers
    const bentoDate = this.modalOverlay.querySelector('#gcal-detail-bento-date');
    const bentoTime = this.modalOverlay.querySelector('#gcal-detail-bento-time');
    const openRescheduleBtn = this.modalOverlay.querySelector('#gcal-detail-btn-open-reschedule');
    const closeRescheduleBtn = this.modalOverlay.querySelector('#gcal-reschedule-btn-close-panel');
    const cancelRescheduleBtn = this.modalOverlay.querySelector('#gcal-reschedule-btn-cancel');

    bentoDate?.addEventListener('click', () => this.toggleReschedulePanel());
    bentoTime?.addEventListener('click', () => this.toggleReschedulePanel());
    openRescheduleBtn?.addEventListener('click', () => this.toggleReschedulePanel(true));
    closeRescheduleBtn?.addEventListener('click', () => this.toggleReschedulePanel(false));
    cancelRescheduleBtn?.addEventListener('click', () => this.toggleReschedulePanel(false));

    // Calendar navigation
    const prevMonthBtn = this.modalOverlay.querySelector('#gcal-reschedule-cal-prev');
    const nextMonthBtn = this.modalOverlay.querySelector('#gcal-reschedule-cal-next');

    prevMonthBtn?.addEventListener('click', () => {
      this.rescheduleCalendarViewDate = new Date(
        this.rescheduleCalendarViewDate.getFullYear(),
        this.rescheduleCalendarViewDate.getMonth() - 1,
        1
      );
      this.renderRescheduleCalendar();
    });

    nextMonthBtn?.addEventListener('click', () => {
      this.rescheduleCalendarViewDate = new Date(
        this.rescheduleCalendarViewDate.getFullYear(),
        this.rescheduleCalendarViewDate.getMonth() + 1,
        1
      );
      this.renderRescheduleCalendar();
    });

    // Quick date presets
    const presetButtons = this.modalOverlay.querySelectorAll<HTMLButtonElement>('.gcal-reschedule-preset-btn');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const days = parseInt(btn.getAttribute('data-days') || '1', 10);
        const base = new Date(this.rescheduleDate);
        base.setDate(base.getDate() + days);
        this.rescheduleDate = base;
        this.rescheduleCalendarViewDate = new Date(base.getFullYear(), base.getMonth(), 1);
        this.renderRescheduleCalendar();
        this.updateReschedulePreview();
      });
    });

    // Time inputs
    const startInput = this.modalOverlay.querySelector('#gcal-reschedule-input-start') as HTMLInputElement;
    const endInput = this.modalOverlay.querySelector('#gcal-reschedule-input-end') as HTMLInputElement;

    startInput?.addEventListener('input', () => {
      this.rescheduleStartTime = startInput.value;
      this.updateReschedulePreview();
    });

    endInput?.addEventListener('input', () => {
      this.rescheduleEndTime = endInput.value;
      this.updateReschedulePreview();
    });

    // Quick duration chips
    const durButtons = this.modalOverlay.querySelectorAll<HTMLButtonElement>('.gcal-reschedule-dur-btn');
    durButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const special = btn.getAttribute('data-special');
        if (special === 'endofday') {
          this.rescheduleEndTime = '23:59';
          if (endInput) endInput.value = '23:59';
        } else {
          const hours = parseFloat(btn.getAttribute('data-hours') || '1');
          const [sh, sm] = (this.rescheduleStartTime || '09:00').split(':').map(Number);
          const totalMins = sh * 60 + sm + Math.round(hours * 60);
          const eh = Math.floor(totalMins / 60) % 24;
          const em = totalMins % 60;
          this.rescheduleEndTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
          if (endInput) endInput.value = this.rescheduleEndTime;
        }
        this.updateReschedulePreview();
      });
    });

    // Confirm Move Button
    const confirmMoveBtn = this.modalOverlay.querySelector('#gcal-reschedule-btn-confirm') as HTMLButtonElement;
    confirmMoveBtn?.addEventListener('click', async () => {
      confirmMoveBtn.disabled = true;
      safeSetInnerHTML(confirmMoveBtn, '<span>⏳</span> <span>Moviendo evento en Google Calendar...</span>');

      const newIsoDate = this.formatIsoDate(this.rescheduleDate);
      const newPayload: AcademicEventPayload = {
        type: detail.type,
        subject: detail.subject,
        title: detail.title,
        description: detail.description,
        date: newIsoDate,
        startTime: this.rescheduleStartTime,
        endTime: this.rescheduleEndTime
      };

      try {
        const adapter = GoogleCalendarAdapter.getInstance();
        await adapter.moveAcademicEvent(detail.eventId, newPayload);

        // Update local metadata in isolated storage [P0-03]
        try {
          const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
          const cleanKey = detail.title.toLowerCase().trim();
          const fullKey = `${cleanKey}_${detail.subject.toLowerCase().trim()}`;
          const currentEntry = meta[fullKey] || meta[cleanKey] || {};
          currentEntry.date = newIsoDate;
          currentEntry.startTime = this.rescheduleStartTime;
          currentEntry.endTime = this.rescheduleEndTime;
          meta[cleanKey] = currentEntry;
          meta[fullKey] = currentEntry;
          setIsolatedItem('gcal_academic_meta', JSON.stringify(meta));
        } catch (_) {}

        // Fade old chip
        if (detail.chipElement) {
          detail.chipElement.style.transition = 'opacity 0.25s ease';
          detail.chipElement.style.opacity = '0.4';
        }

        const dateEs = this.formatDateEs(this.rescheduleDate);
        const toastMsg = `✓ Evento movido a ${dateEs} (${this.rescheduleStartTime} - ${this.rescheduleEndTime})`;
        this.showToast(toastMsg);

        setTimeout(() => {
          this.close();
          adapter.navigateToEventDate(newIsoDate, toastMsg);
        }, 650);
      } catch (_err: any) {
        confirmMoveBtn.disabled = false;
        safeSetInnerHTML(confirmMoveBtn, '<span>🚀 Confirmar y Mover</span>');
        this.showToast('❌ Error al mover el evento');
      }
    });
  }

  private formatDateEs(d: Date): string {
    const dayName = DAY_NAMES_ES[d.getDay()];
    const day = d.getDate();
    const monthName = MONTH_NAMES_ES[d.getMonth()];
    const year = d.getFullYear();
    return `${dayName}, ${day} de ${monthName} de ${year}`;
  }

  private formatIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private renderRescheduleCalendar(): void {
    if (!this.modalOverlay) return;
    const monthTitle = this.modalOverlay.querySelector('#gcal-reschedule-cal-month-title');
    const grid = this.modalOverlay.querySelector('#gcal-reschedule-calendar-grid');
    if (!monthTitle || !grid) return;

    const viewYear = this.rescheduleCalendarViewDate.getFullYear();
    const viewMonth = this.rescheduleCalendarViewDate.getMonth();
    monthTitle.textContent = `${MONTH_NAMES_ES[viewMonth]} ${viewYear}`;

    safeSetInnerHTML(grid, '');

    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    const startDayOffset = (firstDayOfMonth.getDay() + 6) % 7;

    const today = new Date();
    const isToday = (d: number, m: number, y: number) =>
      d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
    const isSelected = (d: number, m: number, y: number) =>
      d === this.rescheduleDate.getDate() && m === this.rescheduleDate.getMonth() && y === this.rescheduleDate.getFullYear();

    // Prev month days
    for (let i = startDayOffset - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const cell = document.createElement('div');
      cell.style.cssText = 'padding: 6px 0; text-align: center; font-size: 11px; color: var(--gcal-disabled, #bdc1c6); border-radius: 6px; cursor: pointer; user-select: none;';
      cell.textContent = String(dayNum);
      cell.addEventListener('click', () => {
        const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
        const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
        this.rescheduleDate = new Date(prevYear, prevMonth, dayNum);
        this.rescheduleCalendarViewDate = new Date(prevYear, prevMonth, 1);
        this.renderRescheduleCalendar();
        this.updateReschedulePreview();
      });
      grid.appendChild(cell);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      const sel = isSelected(d, viewMonth, viewYear);
      const tod = isToday(d, viewMonth, viewYear);

      let bg = 'transparent';
      let color = 'var(--gcal-text, #1f1f1f)';
      let fontWeight = '500';
      let border = '1px solid transparent';

      if (sel) {
        bg = 'var(--gcal-accent, #1a73e8)';
        color = '#ffffff';
        fontWeight = '700';
      } else if (tod) {
        border = '1px solid var(--gcal-accent, #1a73e8)';
        fontWeight = '700';
      }

      cell.style.cssText = `padding: 6px 0; text-align: center; font-size: 12px; font-weight: ${fontWeight}; color: ${color}; background: ${bg}; border: ${border}; border-radius: 8px; cursor: pointer; transition: all 0.15s ease; font-family: inherit; outline: none; user-select: none;`;
      cell.textContent = String(d);

      if (!sel) {
        cell.onmouseover = () => { cell.style.background = 'var(--gcal-surface-hover, #f1f3f4)'; };
        cell.onmouseout = () => { cell.style.background = 'transparent'; };
      }

      const dayVal = d;
      cell.addEventListener('click', () => {
        this.rescheduleDate = new Date(viewYear, viewMonth, dayVal);
        this.renderRescheduleCalendar();
        this.updateReschedulePreview();
      });
      grid.appendChild(cell);
    }

    // Next month days
    const totalCells = startDayOffset + daysInMonth;
    const targetTotal = totalCells > 35 ? 42 : 35;
    const remaining = targetTotal - totalCells;
    for (let d = 1; d <= remaining; d++) {
      const cell = document.createElement('div');
      cell.style.cssText = 'padding: 6px 0; text-align: center; font-size: 11px; color: var(--gcal-disabled, #bdc1c6); border-radius: 6px; cursor: pointer; user-select: none;';
      const dayVal = d;
      cell.textContent = String(dayVal);
      cell.addEventListener('click', () => {
        const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
        const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
        this.rescheduleDate = new Date(nextYear, nextMonth, dayVal);
        this.rescheduleCalendarViewDate = new Date(nextYear, nextMonth, 1);
        this.renderRescheduleCalendar();
        this.updateReschedulePreview();
      });
      grid.appendChild(cell);
    }
  }

  private updateReschedulePreview(): void {
    if (!this.modalOverlay || !this.currentDetail) return;
    const summary = this.modalOverlay.querySelector('#gcal-reschedule-summary');
    if (!summary) return;

    const detail = this.currentDetail;
    const newDateStr = this.formatDateEs(this.rescheduleDate);

    // Calculate day offset compared to original
    let diffBadge = 'Mismo día';
    if (detail.isoDate && /^\d{4}-\d{2}-\d{2}$/.test(detail.isoDate)) {
      const [oy, om, od] = detail.isoDate.split('-').map(Number);
      const origDate = new Date(oy, om - 1, od);
      const newD = new Date(this.rescheduleDate.getFullYear(), this.rescheduleDate.getMonth(), this.rescheduleDate.getDate());
      const msDiff = newD.getTime() - origDate.getTime();
      const dayDiff = Math.round(msDiff / (1000 * 60 * 60 * 24));
      if (dayDiff > 0) {
        diffBadge = `+${dayDiff} día${dayDiff > 1 ? 's' : ''}`;
      } else if (dayDiff < 0) {
        diffBadge = `${dayDiff} día${Math.abs(dayDiff) > 1 ? 's' : ''}`;
      }
    }

    safeSetInnerHTML(
      summary,
      `
      <div style="display: flex; align-items: center; justify-content: space-between; font-weight: 700; color: var(--gcal-text, #1f1f1f); margin-bottom: 2px;">
        <span style="display: flex; align-items: center; gap: 5px;"><span>🔄</span> Comparativa del cambio:</span>
        <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; background: rgba(26, 115, 232, 0.12); color: var(--gcal-accent, #1a73e8); font-weight: 700;">${diffBadge}</span>
      </div>
      <div style="color: var(--gcal-secondary-text, #5f6368); font-size: 11.5px; line-height: 1.45;">
        <div><span style="text-decoration: line-through; opacity: 0.75;">Original:</span> ${escapeHtml(detail.dateStr)} &bull; ${escapeHtml(detail.startTime)} - ${escapeHtml(detail.endTime)}</div>
        <div style="color: var(--gcal-accent, #1a73e8); font-weight: 700; margin-top: 2px;"><span>Nueva fecha:</span> ${escapeHtml(newDateStr)} &bull; ${escapeHtml(this.rescheduleStartTime)} - ${escapeHtml(this.rescheduleEndTime)}</div>
      </div>
    `
    );
  }

  private toggleReschedulePanel(open?: boolean): void {
    if (!this.modalOverlay) return;
    const panel = this.modalOverlay.querySelector('#gcal-detail-reschedule-panel') as HTMLElement;
    const deleteConfirmBox = this.modalOverlay.querySelector('#gcal-detail-delete-confirm') as HTMLElement;
    const completePanel = this.modalOverlay.querySelector('#gcal-detail-complete-panel') as HTMLElement;

    this.isRescheduling = open !== undefined ? open : !this.isRescheduling;

    if (panel) {
      panel.style.display = this.isRescheduling ? 'flex' : 'none';
      if (this.isRescheduling) {
        if (deleteConfirmBox) deleteConfirmBox.style.display = 'none';
        if (completePanel) completePanel.style.display = 'none';
        this.isDeleting = false;
        this.isCompletePanelOpen = false;
        this.renderRescheduleCalendar();
        this.updateReschedulePreview();
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  public setCompletionState(isDone: boolean, mode: 'dimmed' = 'dimmed'): void {
    if (!this.currentDetail) return;
    const detail = this.currentDetail;
    detail.isCompleted = isDone;

    try {
      const meta = JSON.parse(getIsolatedItem('gcal_academic_meta') || '{}');
      const cleanKey = detail.title.toLowerCase().trim();
      const fullKey = `${cleanKey}_${detail.subject.toLowerCase().trim()}`;

      const entry = meta[fullKey] || meta[cleanKey] || {
        description: detail.description,
        subject: detail.subject,
        type: detail.type
      };

      entry.completed = isDone;
      entry.hiddenMode = isDone ? mode : undefined;
      entry.title = detail.title;
      entry.subject = detail.subject;
      meta[cleanKey] = entry;
      meta[fullKey] = entry;
      if (detail.eventId) meta[detail.eventId] = entry;

      setIsolatedItem('gcal_academic_meta', JSON.stringify(meta));
    } catch (_) {}

    // Update chip in calendar grid
    if (detail.chipElement) {
      if (isDone) {
        detail.chipElement.classList.add('gcal-chip-dimmed');
      } else {
        detail.chipElement.classList.remove('gcal-chip-dimmed');
        detail.chipElement.style.removeProperty('opacity');
      }
      detail.chipElement.removeAttribute('data-gcal-enhanced');
    }

    if (typeof document !== 'undefined') {
      GoogleCalendarAdapter.getInstance().enhanceAcademicChips();

      // Re-render modal in place to reflect new state
      const chip = detail.chipElement;
      this.close();
      this.open(chip);

      if (isDone) {
        this.showToast('✓ Entrega guardada en modo oculto (baja opacidad)');
      } else {
        this.showToast('✓ Entrega devuelta a la normalidad');
      }
    }
  }

  private showToast(msg: string): void {
    if (!this.modalOverlay) return;
    const toast = this.modalOverlay.querySelector('#gcal-detail-toast') as HTMLElement;
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(() => {
        if (toast) toast.style.display = 'none';
      }, 2500);
    }
  }

  public destroy(): void {
    this.close();
    AcademicDetailModal.instance = null;
  }
}
