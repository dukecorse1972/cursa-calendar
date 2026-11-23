import { safeSetInnerHTML, escapeHtml, setupFocusTrap } from '../../utils/dom';
import { GeminiGradesService } from '../../services/geminiGradesService';
import {
  AISyllabusExtraction,
  GradesChatTurn,
  SubjectGradesConfig
} from '../../../shared/gradesTypes';
import {
  decomposeCompositeItems,
  mergeSyllabusPreservingData
} from '../../../shared/gradesCalculator';
import { saveSubjectGrades } from '../../services/gradesStorage';
import { GRADES_ICONS } from './gradesIcons';
import { injectGradesStyles } from './gradesStyles';
import { ThemeManager } from '../../theme/ThemeManager';

export class GradesChatModal {
  private static instance: GradesChatModal | null = null;
  private overlayEl: HTMLElement | null = null;
  private currentSubject: string = '';
  private currentCredits: number = 6;
  private existingConfig: SubjectGradesConfig | null = null;
  private preserveExistingData: boolean = true;
  private history: GradesChatTurn[] = [];
  private onFinished: ((config: SubjectGradesConfig) => void) | null = null;
  private focusTrapCleanup: (() => void) | null = null;
  private pendingExtraction: AISyllabusExtraction | null = null;
  private isThinking: boolean = false;

  public static getInstance(): GradesChatModal {
    if (!GradesChatModal.instance) {
      GradesChatModal.instance = new GradesChatModal();
    }
    return GradesChatModal.instance;
  }

  private constructor() {}

  public open(
    subjectName: string,
    credits: number,
    onFinished: (config: SubjectGradesConfig) => void,
    existingConfig: SubjectGradesConfig | null = null
  ): void {
    injectGradesStyles();
    this.currentSubject = subjectName;
    this.currentCredits = credits || 6;
    this.existingConfig = existingConfig;
    this.preserveExistingData = true;
    this.history = [];
    this.onFinished = onFinished;
    this.pendingExtraction = null;
    this.isThinking = false;

    this.render();
  }

  public close(): void {
    if (this.focusTrapCleanup) {
      this.focusTrapCleanup();
      this.focusTrapCleanup = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  private render(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'cursa-grades-chat-modal-overlay';
    overlay.setAttribute('data-cg-theme', ThemeManager.getInstance().getTheme() === 'DARK' ? 'dark' : 'light');

    const geminiService = GeminiGradesService.getInstance();
    const hasKey = geminiService.hasApiKey();
    const hasExisting = Boolean(this.existingConfig && this.existingConfig.items.length > 0);

    safeSetInnerHTML(
      overlay,
      `
      <div id="cursa-grades-chat-card" class="cg-chat-card">
        <div class="cg-chat-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="
              width: 36px;
              height: 36px;
              border-radius: 10px;
              background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #ffffff;
              flex-shrink: 0;
            ">${GRADES_ICONS.sparkles(18)}</div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-weight: 600; font-size: 15px;">Asistente de Guía Docente</span>
                <span class="cg-pill cg-pill-accent">${escapeHtml(this.currentSubject)}</span>
              </div>
              <div style="font-size: 12px; color: var(--cg-muted); margin-top: 1px;">
                Gemini 2.5 Flash · Conversación multi-turno con cortes por ítem y bloque
              </div>
            </div>
          </div>
          <button id="cursa-chat-close-btn" type="button" class="cg-btn cg-btn-ghost" style="width: 32px; height: 32px; padding: 0; justify-content: center;" title="Cerrar">
            ${GRADES_ICONS.x(16)}
          </button>
        </div>

        <div id="cursa-api-key-banner" style="
          ${hasKey ? 'display: none;' : 'display: flex;'}
          background: var(--cg-surface-2);
          border-bottom: 1px solid var(--cg-border);
          padding: 10px 18px;
          font-size: 12px;
          flex-direction: column;
          gap: 8px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span><strong>Clave de Gemini API</strong> (gratuita en Google AI Studio):</span>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--cg-accent); font-weight: 600; text-decoration: none;">Obtener gratis ↗</a>
          </div>
          <div style="display: flex; gap: 8px;">
            <input id="cursa-api-key-input" type="password" placeholder="Pega tu clave (AIzaSy...)" style="
              flex: 1;
              height: 30px;
              padding: 0 10px;
              border-radius: 8px;
              border: 1px solid var(--cg-border);
              font-size: 12px;
              background: var(--cg-bg);
              color: var(--cg-text);
              outline: none;
            " />
            <button id="cursa-api-key-save-btn" type="button" class="cg-btn cg-btn-primary cg-btn-sm">Guardar</button>
            <button id="cursa-use-offline-btn" type="button" class="cg-btn cg-btn-sm">Modo Local</button>
          </div>
        </div>

        ${
          hasExisting
            ? `<div style="
                padding: 8px 18px;
                background: var(--cg-accent-soft);
                border-bottom: 1px solid var(--cg-accent-border);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                font-size: 12px;
              ">
                <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; color: var(--cg-text); font-weight: 500;">
                  <input id="cursa-preserve-grades-chk" type="checkbox" checked style="accent-color: var(--cg-accent); cursor: pointer;" />
                  <span>Conservar mis notas ya puestas y eventos de calendario vinculados</span>
                </label>
                <span style="color: var(--cg-muted);">${this.existingConfig!.items.length} hitos actuales</span>
              </div>`
            : ''
        }

        <div id="cursa-chat-messages" class="cg-chat-messages">
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <div style="
              width: 28px;
              height: 28px;
              border-radius: 8px;
              background: linear-gradient(135deg, #2563eb, #7c3aed);
              color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
            ">${GRADES_ICONS.sparkles(14)}</div>
            <div class="cg-chat-bubble-bot">
              <div>
                ${
                  hasExisting
                    ? `Tengo en cuenta tu configuración actual de <strong>${escapeHtml(this.currentSubject)}</strong>. Dime qué quieres cambiar o pega la guía docente completa.`
                    : `Explícame con tus palabras o pega la guía docente de <strong>${escapeHtml(this.currentSubject)}</strong>.`
                }
              </div>
              <div style="margin-top: 6px; color: var(--cg-muted); font-size: 12.5px;">
                Puedo separar bloques y temas, calcular pesos globales, detectar notas mínimas <em>por bloque</em> o <em>por examen concreto</em>, y puedes pedirme correcciones en varios mensajes.
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px;">
                <button type="button" class="cg-btn cg-btn-sm cursa-quick-starter-btn" data-text="50% Teoría y 50% Prácticas. Mínimo 4.0 en cada bloque para hacer media. Teoría: Test 30% y Examen de problemas 70% (mínimo 4.0 en problemas). Prácticas: 4 temas de 25% cada uno; Tema 1 ya aprobado con 7.33.">
                  50% Teoría + 50% Prácticas (con cortes)
                </button>
                <button type="button" class="cg-btn cg-btn-sm cursa-quick-starter-btn" data-text="Examen final 60% con nota mínima de 4.5, prácticas de laboratorio 25% y dos parciales que valen 15% en total.">
                  Final 60% (corte 4.5) + Lab 25% + Parciales 15%
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="cg-chat-input-bar">
          <textarea id="cursa-chat-input" class="cg-chat-textarea" rows="1" placeholder="Pega la guía docente o pide un ajuste... (Enter envía, Shift+Enter salto de línea)"></textarea>
          <button id="cursa-chat-send-btn" type="button" class="cg-btn cg-btn-primary" style="width: 40px; height: 40px; padding: 0; justify-content: center; border-radius: 12px;" title="Enviar">
            ${GRADES_ICONS.send(15)}
          </button>
        </div>
      </div>
    `
    );

    document.body.appendChild(overlay);
    this.overlayEl = overlay;
    this.focusTrapCleanup = setupFocusTrap(overlay);

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    if (!this.overlayEl) return;

    this.overlayEl.querySelector('#cursa-chat-close-btn')?.addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) this.close();
    });

    const preserveChk = this.overlayEl.querySelector('#cursa-preserve-grades-chk') as HTMLInputElement | null;
    preserveChk?.addEventListener('change', () => {
      this.preserveExistingData = preserveChk.checked;
    });

    const apiKeyInput = this.overlayEl.querySelector('#cursa-api-key-input') as HTMLInputElement | null;
    const apiKeySaveBtn = this.overlayEl.querySelector('#cursa-api-key-save-btn');
    const apiKeyBanner = this.overlayEl.querySelector('#cursa-api-key-banner') as HTMLElement | null;
    const useOfflineBtn = this.overlayEl.querySelector('#cursa-use-offline-btn');

    apiKeySaveBtn?.addEventListener('click', () => {
      const key = apiKeyInput?.value?.trim();
      if (key) {
        GeminiGradesService.getInstance().setApiKey(key);
        if (apiKeyBanner) apiKeyBanner.style.display = 'none';
        this.addBotMessage('Clave de Gemini guardada. Cuéntame cómo evalúan esta asignatura.');
      }
    });

    useOfflineBtn?.addEventListener('click', () => {
      if (apiKeyBanner) apiKeyBanner.style.display = 'none';
      this.addBotMessage('Modo local activado. Procesaré tu texto con el motor integrado.');
    });

    this.overlayEl.querySelectorAll<HTMLButtonElement>('.cursa-quick-starter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-text');
        if (text && !this.isThinking) {
          this.addUserMessage(text);
          this.processUserMessage(text);
        }
      });
    });

    const chatInput = this.overlayEl.querySelector('#cursa-chat-input') as HTMLTextAreaElement | null;
    const chatSendBtn = this.overlayEl.querySelector('#cursa-chat-send-btn');

    const autoResize = () => {
      if (!chatInput) return;
      chatInput.style.height = 'auto';
      chatInput.style.height = `${Math.min(130, Math.max(40, chatInput.scrollHeight))}px`;
    };
    chatInput?.addEventListener('input', autoResize);

    const handleSend = async () => {
      const text = chatInput?.value?.trim();
      if (!text || this.isThinking) return;
      if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = '40px';
      }
      this.addUserMessage(text);
      await this.processUserMessage(text);
    };

    chatSendBtn?.addEventListener('click', handleSend);
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    setTimeout(() => chatInput?.focus(), 80);
  }

  private addUserMessage(text: string): void {
    const container = this.overlayEl?.querySelector('#cursa-chat-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.style.cssText = 'display: flex; justify-content: flex-end;';
    safeSetInnerHTML(div, `<div class="cg-chat-bubble-user">${escapeHtml(text)}</div>`);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  private addBotMessage(html: string): HTMLElement | null {
    const container = this.overlayEl?.querySelector('#cursa-chat-messages');
    if (!container) return null;

    const div = document.createElement('div');
    div.style.cssText = 'display: flex; gap: 10px; align-items: flex-start;';
    safeSetInnerHTML(
      div,
      `
      <div style="
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: linear-gradient(135deg, #2563eb, #7c3aed);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      ">${GRADES_ICONS.sparkles(14)}</div>
      <div class="cg-chat-bubble-bot">${html}</div>
    `
    );
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  private async processUserMessage(text: string): Promise<void> {
    this.isThinking = true;
    this.history.push({ role: 'user', text });

    const container = this.overlayEl?.querySelector('#cursa-chat-messages');
    const loadingId = 'cursa-chat-loading-indicator';

    if (container) {
      const loadingDiv = document.createElement('div');
      loadingDiv.id = loadingId;
      loadingDiv.style.cssText =
        'display: flex; gap: 10px; align-items: center; color: var(--cg-muted); font-size: 12.5px; padding-left: 38px;';
      safeSetInnerHTML(loadingDiv, `<div class="cg-spinner"></div><span>Analizando estructura y reglas de corte...</span>`);
      container.appendChild(loadingDiv);
      container.scrollTop = container.scrollHeight;
    }

    const geminiService = GeminiGradesService.getInstance();
    let extraction: AISyllabusExtraction;

    try {
      if (geminiService.hasApiKey()) {
        extraction = await geminiService.extractSyllabusMultiTurn(
          this.currentSubject,
          this.history,
          this.existingConfig
        );
      } else {
        await new Promise((r) => setTimeout(r, 350));
        extraction = geminiService.extractSyllabusOfflineFallback(this.currentSubject, text);
      }
    } catch (err: any) {
      document.getElementById(loadingId)?.remove();
      this.isThinking = false;
      this.history.pop();

      if (err.message === 'NO_API_KEY') {
        const apiKeyBanner = this.overlayEl?.querySelector('#cursa-api-key-banner') as HTMLElement | null;
        if (apiKeyBanner) apiKeyBanner.style.display = 'flex';
        this.addBotMessage('Introduce tu clave de Gemini arriba o pulsa <strong>Modo Local</strong> para continuar.');
      } else {
        this.addBotMessage(`${escapeHtml(err.message)}<br/><span style="color: var(--cg-muted);">Puedes reintentarlo o usar el Modo Local.</span>`);
      }
      return;
    }

    document.getElementById(loadingId)?.remove();
    this.isThinking = false;
    this.pendingExtraction = extraction;
    this.history.push({ role: 'model', text: JSON.stringify(extraction) });

    const totalWeight = Math.round(extraction.items.reduce((s, it) => s + it.weight, 0) * 10) / 10;
    const isSum100 = Math.abs(totalWeight - 100) < 0.05;

    const itemsHtml = extraction.items
      .map((it) => {
        const pathLabel = [it.category, it.subcategory].filter(Boolean).join(' · ');
        return `
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 7px 0;
            border-bottom: 1px solid var(--cg-border-subtle);
            font-size: 12.5px;
          ">
            <div style="min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="cg-pill cg-pill-neutral" style="font-size: 10.5px; padding: 1px 6px;">${it.type}</span>
                <span style="font-weight: 500; color: var(--cg-text);">${escapeHtml(it.name)}</span>
                ${
                  typeof it.minGradeRequired === 'number'
                    ? `<span class="cg-pill cg-pill-warn" style="font-size: 10.5px; padding: 1px 6px;">Mín. ${it.minGradeRequired.toFixed(1)}</span>`
                    : ''
                }
                ${
                  it.grade !== null && it.grade !== undefined
                    ? `<span class="cg-pill cg-pill-success" style="font-size: 10.5px; padding: 1px 6px;">Nota: ${it.grade.toFixed(2)}</span>`
                    : ''
                }
              </div>
              ${pathLabel ? `<div style="font-size: 11px; color: var(--cg-muted); margin-top: 2px;">${escapeHtml(pathLabel)}${it.dateHint ? ` · ${escapeHtml(it.dateHint)}` : ''}</div>` : ''}
            </div>
            <span class="cg-pill cg-pill-accent cg-num">${it.weight}%</span>
          </div>
        `;
      })
      .join('');

    const blockCutoffsEntries = extraction.blockCutoffs ? Object.entries(extraction.blockCutoffs) : [];
    const cutoffsSummaryHtml = [
      ...blockCutoffsEntries.map(
        ([blk, val]) => `<span class="cg-pill cg-pill-warn">${GRADES_ICONS.shield(12)} ${escapeHtml(blk)}: mín. ${val.toFixed(1)}</span>`
      ),
      ...(extraction.minFinalGradeRequired
        ? [`<span class="cg-pill cg-pill-warn">${GRADES_ICONS.shield(12)} Examen final: mín. ${extraction.minFinalGradeRequired.toFixed(1)}</span>`]
        : [])
    ].join(' ');

    const confirmId = `cursa-confirm-apply-${Date.now()}`;
    const previewHtml = `
      <div>
        <p style="margin: 0 0 10px 0; font-size: 13px; line-height: 1.5;">
          ${escapeHtml(extraction.aiExplanation)}
        </p>
        <div style="
          background: var(--cg-surface);
          border: 1px solid var(--cg-border);
          border-radius: 12px;
          padding: 12px 14px;
          margin-bottom: 12px;
        ">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--cg-muted); margin-bottom: 6px;">
            Propuesta estructurada (${extraction.items.length} hitos)
          </div>
          ${itemsHtml}
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 12.5px; font-weight: 600;">
            <span>Ponderación total</span>
            <span class="${isSum100 ? 'cg-pill cg-pill-success' : 'cg-pill cg-pill-warn'} cg-num">
              ${totalWeight}% ${isSum100 ? '· Cuadra al 100%' : '· Revisar suma'}
            </span>
          </div>
          ${
            cutoffsSummaryHtml
              ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">${cutoffsSummaryHtml}</div>`
              : ''
          }
        </div>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button id="${confirmId}" type="button" class="cg-btn cg-btn-primary">
            ${GRADES_ICONS.check(14)}
            <span>Aplicar al Simulador</span>
          </button>
          <span style="font-size: 12px; color: var(--cg-muted);">O escríbeme abajo para afinar cualquier detalle.</span>
        </div>
      </div>
    `;

    const msgEl = this.addBotMessage(previewHtml);
    msgEl?.querySelector(`#${confirmId}`)?.addEventListener('click', () => {
      this.finishAndCreate();
    });
  }

  private finishAndCreate(): void {
    if (!this.pendingExtraction) return;

    const rawItems = this.pendingExtraction.items.map((it, idx) => ({
      id: `item_${Date.now()}_${idx}`,
      name: it.name,
      type: it.type,
      weight: it.weight,
      grade: it.grade !== undefined && it.grade !== null ? it.grade : null,
      minGradeRequired: it.minGradeRequired !== undefined && it.minGradeRequired !== null ? it.minGradeRequired : undefined,
      dateHint: it.dateHint || undefined,
      category: it.category || undefined,
      subcategory: it.subcategory || undefined
    }));

    const decomposed = decomposeCompositeItems(rawItems);
    const finalItems =
      this.preserveExistingData && this.existingConfig
        ? mergeSyllabusPreservingData(decomposed, this.existingConfig)
        : decomposed;

    const config: SubjectGradesConfig = {
      subjectName: this.currentSubject,
      credits: this.existingConfig?.credits || this.currentCredits,
      minFinalGradeRequired: this.pendingExtraction.minFinalGradeRequired || undefined,
      blockCutoffs: this.pendingExtraction.blockCutoffs || undefined,
      items: finalItems,
      updatedAt: Date.now()
    };

    saveSubjectGrades(config);
    this.close();

    if (this.onFinished) {
      this.onFinished(config);
    }
  }
}
