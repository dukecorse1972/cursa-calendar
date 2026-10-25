import { safeSetInnerHTML, escapeHtml } from '../../utils/dom';
import { AppState } from '../../state';
import { GoogleCalendarAdapter } from '../../adapter/GoogleCalendarAdapter';

export interface PickedCalendarEvent {
  eventId: string;
  eventTitle: string;
}

export type PickCallback = (result: PickedCalendarEvent) => void;
export type CancelCallback = () => void;

export class CalendarPickerMode {
  private static instance: CalendarPickerMode | null = null;
  private bannerEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private isPicking: boolean = false;
  private currentSubject: string = '';
  private currentItemName: string = '';
  private onPicked: PickCallback | null = null;
  private onCancelled: CancelCallback | null = null;
  private clickInterceptor: ((e: MouseEvent) => void) | null = null;

  public static getInstance(): CalendarPickerMode {
    if (!CalendarPickerMode.instance) {
      CalendarPickerMode.instance = new CalendarPickerMode();
    }
    return CalendarPickerMode.instance;
  }

  private constructor() {}

  public startSelection(
    subjectName: string,
    itemName: string,
    onPicked: PickCallback,
    onCancelled: CancelCallback
  ): void {
    if (this.isPicking) {
      this.cancel();
    }

    this.isPicking = true;
    this.currentSubject = subjectName;
    this.currentItemName = itemName;
    this.onPicked = onPicked;
    this.onCancelled = onCancelled;

    // 1. Switch to ENTREGAS_EXAMENES tab in Google Calendar
    try {
      AppState.getInstance().setActiveTab('ENTREGAS_EXAMENES');
      GoogleCalendarAdapter.getInstance().applyTabFilter('ENTREGAS_EXAMENES', true);
    } catch (_) {}

    // 2. Inject CSS highlighting matching subject chips and guiding selection
    this.injectPickerStyles();

    // 3. Mount guidance banner on top of Google Calendar
    this.mountBanner();

    // 4. Intercept clicks on event chips in capture phase
    this.setupClickInterceptor();
  }

  public cancel(): void {
    const cancelCb = this.onCancelled;
    this.cleanup();
    if (cancelCb) {
      cancelCb();
    }
  }

  private cleanup(): void {
    this.isPicking = false;
    if (this.clickInterceptor && typeof window !== 'undefined') {
      window.removeEventListener('click', this.clickInterceptor, true);
      this.clickInterceptor = null;
    }
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
    }
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
    this.onPicked = null;
    this.onCancelled = null;
  }

  private injectPickerStyles(): void {
    const styleId = 'cursa-calendar-picker-styles';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    this.styleEl = style;

    style.textContent = `
      [data-eventchip] {
        cursor: pointer !important;
        transition: transform 0.15s ease, box-shadow 0.15s ease !important;
      }
      [data-eventchip]:hover {
        transform: scale(1.025) !important;
        box-shadow: 0 0 0 3px #1a73e8, 0 6px 16px rgba(0, 0, 0, 0.25) !important;
        z-index: 9999 !important;
      }
    `;
  }

  private mountBanner(): void {
    if (this.bannerEl) {
      this.bannerEl.remove();
    }

    const banner = document.createElement('div');
    banner.id = 'cursa-picker-top-banner';
    banner.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999999;
      background: #1e293b;
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 30px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), 0 0 0 2px #3b82f6;
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: 'Google Sans', Roboto, -apple-system, sans-serif;
      font-size: 13.5px;
      font-weight: 500;
      animation: cursaFadeIn 0.2s ease;
    `;

    safeSetInnerHTML(
      banner,
      `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">🎯</span>
        <span>Haz clic en el examen/entrega de <strong>${escapeHtml(this.currentSubject)}</strong> para vincular a <em>"${escapeHtml(this.currentItemName)}"</em></span>
      </div>
      <button id="cursa-picker-cancel-btn" type="button" style="
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.25);
        padding: 4px 12px;
        border-radius: 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
      ">✕ Cancelar</button>
    `
    );

    const cancelBtn = banner.querySelector('#cursa-picker-cancel-btn');
    cancelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.cancel();
    });

    document.body.appendChild(banner);
    this.bannerEl = banner;
  }

  private setupClickInterceptor(): void {
    this.clickInterceptor = (e: MouseEvent) => {
      if (!this.isPicking) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('#cursa-picker-top-banner')) {
        return;
      }

      const chip = target.closest<HTMLElement>('[data-eventchip]');
      if (!chip) return;

      // Prevent Google Calendar native detail modal and Cursa's AcademicDetailModal
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Extract title and eventId
      const rawTitle = chip.querySelector('.I0UMhf')?.textContent || chip.getAttribute('aria-label') || 'Evento';
      const cleanTitle = rawTitle.replace(/\[?(?:EXAMEN|ENTREGA)\]?/gi, '').replace(/^[:-]\s*/, '').trim() || rawTitle.trim();
      const eventId = chip.getAttribute('data-eventid') || `event_${Date.now()}`;

      const pickCb = this.onPicked;
      this.cleanup();

      if (pickCb) {
        pickCb({
          eventId,
          eventTitle: cleanTitle
        });
      }
    };

    window.addEventListener('click', this.clickInterceptor, true);
  }
}
