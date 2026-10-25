import { safeSetInnerHTML, escapeHtml, setupFocusTrap } from '../../utils/dom';
import { GeminiGradesService } from '../../services/geminiGradesService';
import { AISyllabusExtraction, SubjectGradesConfig } from '../../../shared/gradesTypes';
import { saveSubjectGrades } from '../../services/gradesStorage';

export class GradesChatModal {
  private static instance: GradesChatModal | null = null;
  private overlayEl: HTMLElement | null = null;
  private currentSubject: string = '';
  private currentCredits: number = 6;
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

  public open(subjectName: string, credits: number, onFinished: (config: SubjectGradesConfig) => void): void {
    this.currentSubject = subjectName;
    this.currentCredits = credits || 6;
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
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(32, 33, 36, 0.6);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      font-family: 'Google Sans', 'Google Sans Text', Roboto, -apple-system, sans-serif;
      box-sizing: border-box;
      padding: 20px;
    `;

    const geminiService = GeminiGradesService.getInstance();
    const hasKey = geminiService.hasApiKey();

    safeSetInnerHTML(
      overlay,
      `
      <div id="cursa-grades-chat-card" style="
        background: var(--gcal-surface, #282a2d);
        color: var(--gcal-text, #e8eaed);
        border: 1px solid var(--gcal-border, #444746);
        border-radius: 24px;
        width: 720px;
        max-width: 94vw;
        height: 640px;
        max-height: 92vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
        overflow: hidden;
      ">
        <!-- Header (Google Gemini in Workspace Style) -->
        <div style="
          padding: 18px 24px;
          border-bottom: 1px solid var(--gcal-border, #444746);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--gcal-surface, #282a2d);
        ">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="
              width: 38px;
              height: 38px;
              border-radius: 12px;
              background: linear-gradient(135deg, #1a73e8 0%, #4285f4 50%, #9b72cb 100%);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 18px;
              color: white;
              box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3);
            ">✨</div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 500; font-size: 16px; font-family: 'Google Sans', Roboto, sans-serif; color: var(--gcal-text, #e8eaed);">Gemini • Asistente de Guía Docente</span>
                <span style="font-size: 11.5px; background: rgba(138, 180, 248, 0.15); color: var(--gcal-accent, #8ab4f8); font-weight: 600; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(138, 180, 248, 0.3);">${escapeHtml(this.currentSubject)}</span>
              </div>
              <div style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6); margin-top: 2px;">
                Google AI Studio • Modelo Gemini 2.5 Flash
              </div>
            </div>
          </div>
          <button id="cursa-chat-close-btn" style="
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: var(--gcal-secondary-text, #9aa0a6);
            border-radius: 50%;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s ease;
          " onmouseover="this.style.background='var(--gcal-surface-hover, #35373b)';" onmouseout="this.style.background='none';">&times;</button>
        </div>

        <!-- API Key Banner if not set -->
        <div id="cursa-api-key-banner" style="
          ${hasKey ? 'display: none;' : 'display: flex;'}
          background: var(--gcal-surface-hover, #35373b);
          border-bottom: 1px solid var(--gcal-border, #444746);
          color: var(--gcal-text, #e8eaed);
          padding: 12px 20px;
          font-size: 12.5px;
          flex-direction: column;
          gap: 8px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>🔑 <strong>Clave de Gemini API</strong> (100% gratuita en Google AI Studio):</span>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--gcal-accent, #8ab4f8); font-weight: 600; text-decoration: none;">Obtener gratis en Google AI Studio ↗</a>
          </div>
          <div style="display: flex; gap: 8px;">
            <input id="cursa-api-key-input" type="password" placeholder="Pega tu clave (AIzaSy...)" style="
              flex: 1;
              padding: 6px 12px;
              border-radius: 8px;
              border: 1px solid var(--gcal-border, #444746);
              font-size: 12px;
              background: var(--gcal-surface, #282a2d);
              color: var(--gcal-text, #e8eaed);
              outline: none;
            " />
            <button id="cursa-api-key-save-btn" type="button" style="
              background: #1a73e8;
              color: #ffffff;
              border: none;
              padding: 6px 14px;
              border-radius: 8px;
              font-weight: 500;
              font-size: 12px;
              cursor: pointer;
            ">Guardar Clave</button>
            <button id="cursa-use-offline-btn" type="button" style="
              background: var(--gcal-surface, #282a2d);
              color: var(--gcal-text, #e8eaed);
              border: 1px solid var(--gcal-border, #444746);
              padding: 6px 12px;
              border-radius: 8px;
              font-size: 12px;
              cursor: pointer;
            ">Modo Local</button>
          </div>
        </div>

        <!-- Messages scroll container -->
        <div id="cursa-chat-messages" style="
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          scrollbar-width: thin;
        ">
          <!-- Initial bot greeting -->
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="
              width: 32px;
              height: 32px;
              border-radius: 50%;
              background: linear-gradient(135deg, #1a73e8, #9b72cb);
              color: white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 15px;
              flex-shrink: 0;
            ">✨</div>
            <div style="
              background: var(--gcal-surface-hover, #35373b);
              border: 1px solid var(--gcal-border, #444746);
              color: var(--gcal-text, #e8eaed);
              padding: 16px 20px;
              border-radius: 18px;
              border-top-left-radius: 4px;
              font-size: 13.5px;
              line-height: 1.6;
              max-width: 88%;
            ">
              ¡Hola! Explícame con tus palabras o pega el texto de la guía docente de <strong style="color: var(--gcal-accent, #8ab4f8);">${escapeHtml(this.currentSubject)}</strong>.
              <p style="margin: 8px 0 0 0; color: var(--gcal-secondary-text, #9aa0a6); line-height: 1.5;">
                Gemini desglosará automáticamente los bloques (Teoría, Prácticas), calculará los pesos finales, capturará las notas que ya tengas y aplicará las notas de corte obligatorias.
              </p>

              <!-- Quick Starters -->
              <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px;">
                <button type="button" class="cursa-quick-starter-btn" data-text="Estructura General: 50% Teoría y 50% Prácticas. Mínimo 4.0 en cada bloque para hacer media. Teoría: Test 30% y Examen 70%. Prácticas: 4 temas de 25% cada uno. Tema 1 ya obtenido con nota 7.33." style="
                  background: var(--gcal-surface, #282a2d);
                  border: 1px solid var(--gcal-border, #444746);
                  color: var(--gcal-accent, #8ab4f8);
                  padding: 8px 14px;
                  border-radius: 14px;
                  font-size: 12px;
                  font-weight: 500;
                  cursor: pointer;
                  text-align: left;
                  transition: all 0.15s ease;
                " onmouseover="this.style.background='var(--gcal-selected, rgba(138, 180, 248, 0.15))';" onmouseout="this.style.background='var(--gcal-surface, #282a2d)';">
                  📋 Ejemplo: 50% Teoría + 50% Prácticas (Nota previa 7.33)
                </button>
                <button type="button" class="cursa-quick-starter-btn" data-text="La evaluación se compone de un examen final del 70% con nota de corte mínima de 4.0, y evaluación continua del 30% consistente en entregas quincenales." style="
                  background: var(--gcal-surface, #282a2d);
                  border: 1px solid var(--gcal-border, #444746);
                  color: var(--gcal-accent, #8ab4f8);
                  padding: 8px 14px;
                  border-radius: 14px;
                  font-size: 12px;
                  font-weight: 500;
                  cursor: pointer;
                  text-align: left;
                  transition: all 0.15s ease;
                " onmouseover="this.style.background='var(--gcal-selected, rgba(138, 180, 248, 0.15))';" onmouseout="this.style.background='var(--gcal-surface, #282a2d)';">
                  📝 Ejemplo: Examen Final 70% (Corte 4.0) + Entregas 30%
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Chat Input Bar (Gemini Workspace Style) -->
        <div style="
          padding: 16px 20px;
          border-top: 1px solid var(--gcal-border, #444746);
          display: flex;
          align-items: center;
          gap: 10px;
          background: var(--gcal-surface, #282a2d);
        ">
          <div style="
            flex: 1;
            display: flex;
            align-items: center;
            background: var(--gcal-surface-hover, #35373b);
            border: 1px solid var(--gcal-border, #444746);
            border-radius: 24px;
            padding: 4px 16px;
            transition: border-color 0.15s ease;
          " id="cursa-chat-input-wrapper">
            <input id="cursa-chat-input" type="text" placeholder="Escribe o pega aquí el desglose de la asignatura..." style="
              flex: 1;
              padding: 8px 0;
              border: none;
              background: transparent;
              color: var(--gcal-text, #e8eaed);
              font-size: 13.5px;
              outline: none;
              font-family: inherit;
            " />
          </div>
          <button id="cursa-chat-send-btn" type="button" style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--gcal-accent, #1a73e8);
            color: #ffffff;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: opacity 0.15s ease, box-shadow 0.15s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          " onmouseover="this.style.opacity='0.9';" onmouseout="this.style.opacity='1';">➤</button>
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

    // Close button
    const closeBtn = this.overlayEl.querySelector('#cursa-chat-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    // API Key Save button
    const apiKeyInput = this.overlayEl.querySelector('#cursa-api-key-input') as HTMLInputElement;
    const apiKeySaveBtn = this.overlayEl.querySelector('#cursa-api-key-save-btn');
    const apiKeyBanner = this.overlayEl.querySelector('#cursa-api-key-banner') as HTMLElement;
    const useOfflineBtn = this.overlayEl.querySelector('#cursa-use-offline-btn');

    apiKeySaveBtn?.addEventListener('click', () => {
      const key = apiKeyInput?.value?.trim();
      if (key) {
        GeminiGradesService.getInstance().setApiKey(key);
        apiKeyBanner.style.display = 'none';
        this.addBotMessage('✓ ¡Clave de Gemini guardada correctamente! Ahora cuéntame cómo te evalúan o usa uno de los ejemplos.');
      }
    });

    useOfflineBtn?.addEventListener('click', () => {
      apiKeyBanner.style.display = 'none';
      this.addBotMessage('ℹ️ Has activado el modo local. Procesaré tu texto con el motor universitario integrado.');
    });

    // Quick starter chips
    this.overlayEl.querySelectorAll<HTMLButtonElement>('.cursa-quick-starter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-text');
        if (text) {
          this.addUserMessage(text);
          this.processUserMessage(text);
        }
      });
    });

    // Chat Send
    const chatInput = this.overlayEl.querySelector('#cursa-chat-input') as HTMLInputElement;
    const chatSendBtn = this.overlayEl.querySelector('#cursa-chat-send-btn');
    const inputWrapper = this.overlayEl.querySelector('#cursa-chat-input-wrapper') as HTMLElement;

    chatInput?.addEventListener('focus', () => {
      if (inputWrapper) inputWrapper.style.borderColor = '#1a73e8';
    });
    chatInput?.addEventListener('blur', () => {
      if (inputWrapper) inputWrapper.style.borderColor = 'var(--gcal-border, #dadce0)';
    });

    const handleSend = async () => {
      const text = chatInput?.value?.trim();
      if (!text || this.isThinking) return;

      chatInput.value = '';
      this.addUserMessage(text);
      await this.processUserMessage(text);
    };

    chatSendBtn?.addEventListener('click', handleSend);
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSend();
      }
    });

    setTimeout(() => chatInput?.focus(), 100);
  }

  private addUserMessage(text: string): void {
    const container = this.overlayEl?.querySelector('#cursa-chat-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.style.cssText = 'display: flex; justify-content: flex-end;';
    div.innerHTML = `
      <div style="
        background: var(--gcal-selected, #004a77);
        border: 1px solid var(--gcal-border, #444746);
        color: var(--gcal-text, #e8eaed);
        padding: 10px 16px;
        border-radius: 18px;
        border-top-right-radius: 4px;
        font-size: 13.5px;
        line-height: 1.5;
        max-width: 80%;
      ">${escapeHtml(text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  private addBotMessage(html: string): void {
    const container = this.overlayEl?.querySelector('#cursa-chat-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.style.cssText = 'display: flex; gap: 12px; align-items: flex-start;';
    div.innerHTML = `
      <div style="
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, #1a73e8, #9b72cb);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        flex-shrink: 0;
      ">✨</div>
      <div style="
        background: var(--gcal-surface-hover, #35373b);
        border: 1px solid var(--gcal-border, #444746);
        color: var(--gcal-text, #e8eaed);
        padding: 16px 20px;
        border-radius: 18px;
        border-top-left-radius: 4px;
        font-size: 13.5px;
        line-height: 1.6;
        max-width: 88%;
      ">${html}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  private async processUserMessage(text: string): Promise<void> {
    this.isThinking = true;
    const container = this.overlayEl?.querySelector('#cursa-chat-messages');
    const loadingId = 'cursa-chat-loading-indicator';

    if (container) {
      const loadingDiv = document.createElement('div');
      loadingDiv.id = loadingId;
      loadingDiv.style.cssText = 'display: flex; gap: 12px; align-items: center; color: var(--gcal-secondary-text, #9aa0a6); font-size: 13px; padding-left: 44px;';
      loadingDiv.innerHTML = `
        <div style="width: 18px; height: 18px; border: 2px solid var(--gcal-accent, #8ab4f8); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <span>Razonando con Gemini 2.5 Flash...</span>
      `;
      container.appendChild(loadingDiv);
      container.scrollTop = container.scrollHeight;
    }

    const geminiService = GeminiGradesService.getInstance();
    let extraction: AISyllabusExtraction;

    try {
      if (geminiService.hasApiKey()) {
        extraction = await geminiService.extractSyllabus(this.currentSubject, text);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        extraction = geminiService.extractSyllabusOfflineFallback(this.currentSubject, text);
      }
    } catch (err: any) {
      document.getElementById(loadingId)?.remove();
      this.isThinking = false;

      if (err.message === 'NO_API_KEY') {
        const apiKeyBanner = this.overlayEl?.querySelector('#cursa-api-key-banner') as HTMLElement;
        if (apiKeyBanner) apiKeyBanner.style.display = 'flex';
        this.addBotMessage('Para un razonamiento de IA avanzado, introduce tu clave de Gemini arriba. También puedes pulsar "Modo Local" para continuar.');
      } else {
        this.addBotMessage(`⚠️ ${escapeHtml(err.message)}<br/><br/><em>Reinténtalo o pulsa "Modo Local".</em>`);
      }
      return;
    }

    document.getElementById(loadingId)?.remove();
    this.isThinking = false;
    this.pendingExtraction = extraction;

    // Render structured preview card (Google Workspace Card Style)
    const totalWeight = extraction.items.reduce((s, it) => s + it.weight, 0);
    const isSum100 = totalWeight === 100;

    const itemsHtml = extraction.items
      .map(
        (it) => `
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--gcal-border, #444746);
          font-size: 13px;
        ">
          <div>
            <span style="font-weight: 500; color: var(--gcal-text, #e8eaed);">${it.type === 'EXAMEN' ? '📋' : it.type === 'ENTREGA' ? '🗓️' : '📝'} ${escapeHtml(it.name)}</span>
            ${
              it.grade !== null && it.grade !== undefined
                ? `<span style="
                    margin-left: 8px;
                    font-size: 11.5px;
                    color: #81c995;
                    font-weight: 600;
                    background: rgba(129, 201, 149, 0.15);
                    border: 1px solid rgba(129, 201, 149, 0.3);
                    padding: 2px 8px;
                    border-radius: 6px;
                  ">Nota: ${it.grade.toFixed(2)}</span>`
                : ''
            }
            ${
              it.dateHint
                ? `<span style="margin-left: 8px; font-size: 11.5px; color: var(--gcal-secondary-text, #9aa0a6);">📅 ${escapeHtml(it.dateHint)}</span>`
                : ''
            }
          </div>
          <span style="
            font-weight: 600;
            color: var(--gcal-accent, #8ab4f8);
            background: rgba(138, 180, 248, 0.15);
            border: 1px solid rgba(138, 180, 248, 0.3);
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 12.5px;
          ">${it.weight}%</span>
        </div>
      `
      )
      .join('');

    const previewHtml = `
      <div>
        <p style="margin: 0 0 12px 0; font-size: 13.5px; color: var(--gcal-text, #e8eaed); line-height: 1.5;">
          ${escapeHtml(extraction.aiExplanation)}
        </p>
        <div style="
          background: var(--gcal-surface, #282a2d);
          border: 1px solid var(--gcal-border, #444746);
          border-radius: 14px;
          padding: 14px 16px;
          margin-bottom: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        ">
          <div style="
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--gcal-secondary-text, #9aa0a6);
            margin-bottom: 8px;
          ">
            Propuesta de Configuración
          </div>
          ${itemsHtml}
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 10px;
            font-weight: 600;
            font-size: 13px;
            color: ${isSum100 ? '#81c995' : '#fdd663'};
          ">
            <span>Ponderación Total:</span>
            <span>${totalWeight}% ${isSum100 ? '✓ (100% Correcto)' : `⚠️ (Suma ${totalWeight}%)`}</span>
          </div>
          ${
            extraction.minFinalGradeRequired
              ? `<div style="
                  margin-top: 8px;
                  font-size: 12px;
                  color: #fdd663;
                  font-weight: 500;
                  background: rgba(253, 214, 99, 0.12);
                  border: 1px solid rgba(253, 214, 99, 0.3);
                  padding: 6px 12px;
                  border-radius: 8px;
                ">
                  🛡️ Nota de corte en Examen Final: ${extraction.minFinalGradeRequired.toFixed(2)} requerida para hacer media.
                </div>`
              : ''
          }
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button id="cursa-confirm-create-grades-btn" type="button" style="
            background: var(--gcal-accent, #1a73e8);
            color: #ffffff;
            border: none;
            padding: 9px 20px;
            border-radius: 18px;
            font-family: 'Google Sans', Roboto, sans-serif;
            font-weight: 600;
            font-size: 13.5px;
            cursor: pointer;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            transition: opacity 0.15s ease;
          " onmouseover="this.style.opacity='0.9';" onmouseout="this.style.opacity='1';">
            ✓ Aplicar y Guardar en Simulador
          </button>
          <span style="font-size: 12px; color: var(--gcal-secondary-text, #9aa0a6);">O escribe abajo si quieres ajustar algo.</span>
        </div>
      </div>
    `;

    this.addBotMessage(previewHtml);

    // Attach click handler for creation button
    const confirmBtn = this.overlayEl?.querySelector('#cursa-confirm-create-grades-btn');
    confirmBtn?.addEventListener('click', () => {
      this.finishAndCreate();
    });
  }

  private finishAndCreate(): void {
    if (!this.pendingExtraction) return;

    const config: SubjectGradesConfig = {
      subjectName: this.currentSubject,
      credits: this.currentCredits,
      minFinalGradeRequired: this.pendingExtraction.minFinalGradeRequired || undefined,
      blockCutoffs: this.pendingExtraction.blockCutoffs || undefined,
      items: this.pendingExtraction.items.map((it, idx) => ({
        id: `item_${Date.now()}_${idx}`,
        name: it.name,
        type: it.type,
        weight: it.weight,
        grade: it.grade !== undefined && it.grade !== null ? it.grade : null,
        category: it.category,
        subcategory: it.subcategory
      })),
      updatedAt: Date.now()
    };

    saveSubjectGrades(config);
    this.close();

    if (this.onFinished) {
      this.onFinished(config);
    }
  }
}
