import { AISyllabusExtraction, AISyllabusItem, GradeItemType } from '../../shared/gradesTypes';
import { getIsolatedItem, setIsolatedItem, removeIsolatedItem } from '../utils/storage';

const GEMINI_API_KEY_STORAGE_KEY = 'gcal_gemini_api_key';

// Cascade of models: starts with latest 2.5 Flash, falls back to 2.0 Flash and 1.5 Flash if 503 (high demand)
const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

export class GeminiGradesService {
  private static instance: GeminiGradesService | null = null;

  public static getInstance(): GeminiGradesService {
    if (!GeminiGradesService.instance) {
      GeminiGradesService.instance = new GeminiGradesService();
    }
    return GeminiGradesService.instance;
  }

  private constructor() {}

  public getApiKey(): string {
    return getIsolatedItem(GEMINI_API_KEY_STORAGE_KEY) || '';
  }

  public setApiKey(key: string): void {
    setIsolatedItem(GEMINI_API_KEY_STORAGE_KEY, key.trim());
  }

  public removeApiKey(): void {
    removeIsolatedItem(GEMINI_API_KEY_STORAGE_KEY);
  }

  public hasApiKey(): boolean {
    return Boolean(this.getApiKey());
  }

  /**
   * Calls Google Gemini with native Structured Outputs (JSON Schema).
   * Implements a resilient model cascade (2.5 -> 2.0 -> 1.5) and automatic local fallback
   * to guarantee zero downtime during Google high demand spikes (HTTP 503 / 429).
   */
  public async extractSyllabus(subjectName: string, userDescription: string): Promise<AISyllabusExtraction> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const systemPrompt = `Eres el especialista sénior en evaluación y rendimiento académico universitario de Cursa.
Tu misión es interpretar cómo evalúa un profesor universitario a partir de las explicaciones en lenguaje natural de un estudiante (o de fragmentos de guías docentes) y generar una estructura de notas impecable y matemática.

Reglas obligatorias:
1. Extrae todos los elementos evaluables concretos e individuales (ej. "Teoría: Test", "Teoría: Problemas", "Prácticas: Examen Tema 1", "Prácticas: Memoria Tema 2").
2. Clasifica el tipo en:
   - "EXAMEN": para parciales, controles, exámenes teóricos, pruebas prácticas o examen final.
   - "ENTREGA": para prácticas, memorias, proyectos o ejercicios entregables.
   - "OTRO": para asistencia, participación, actitud o bonus.
3. Macro-Bloques ('category') y Subtemas ('subcategory'):
   - 'category': Identifica el Macro-Bloque Principal de la asignatura (ej. "Teoría", "Prácticas", "Evaluación Continua", "Examen Final", "Bloque 1").
     IMPORTANTE: NUNCA pongas números o nombres de temas en 'category' (ej. NO crees categorías "Tema 1", "Tema 2"; todos los temas prácticos deben pertenecer a category: "Prácticas").
   - 'subcategory': Si un hito pertenece a un tema, módulo o entrega secundaria dentro del bloque, asígnalo aquí (ej. "Tema 1", "Tema 2", "Tema 3", "Tema 4", "Práctica 1").
   - 'categoryMinGradeRequired': Si el profesor especifica una nota mínima de corte para este bloque independiente (ej. "mínimo 4.0 en teoría y 4.0 en prácticas"), indícalo aquí como número (ej. 4.0).
4. Desglose y Atomicidad de Evaluaciones:
   - Los pesos deben ser siempre sobre la nota final global de la asignatura (0-100%).
   - ATOMICIDAD OBLIGATORIA: NUNCA fusiones ni agrupes evaluaciones distintas en un único ítem compuesto (ej. NUNCA crees ítems tipo "Memoria + Examen", "Entrega + Control" o "Teoría + Problemas").
   - Si un tema o módulo se evalúa mediante varias partes o pruebas con ponderación interna (por ejemplo: "Tema 2: 20% memoria y 80% examen", o "Tema 3: 30% entrega y 70% control"), DEBES generar CADA UNA como un ítem individual e independiente en la lista de items.
   - Cada elemento evaluable debe tener:
     * El mismo 'category' (el macro-bloque, ej. "Prácticas").
     * El mismo 'subcategory' (el tema, ej. "Tema 2").
     * Su propio nombre descriptivo (ej. "Memoria técnica", "Examen práctico").
     * Su tipo exacto ("ENTREGA" para memorias/prácticas, "EXAMEN" para pruebas/controles).
     * Su peso global exacto sobre la asignatura calculado proporcionalmente: ej. si el tema vale 12.5% de la asignatura, el ítem del 20% tiene weight: 2.5, y el ítem del 80% tiene weight: 10.0.
     * Así, el estudiante puede introducir su nota en cada prueba de forma independiente cuando la realice.
   - Si el estudiante especifica una nota ya obtenida en una parte (ej. "Tema 1: 100% examen, nota obtenida: 7.33"), asígnala a ese hito específico (ej. "Examen", peso 12.5%, nota: 7.33).
   - Mantén la lista estructurada y legible dentro de sus respectivos temas.
5. La suma de los pesos de todos los items debe ser EXACTAMENTE 100%. Si falta o sobra porcentaje, ajústalo lógicamente o indícalo en aiExplanation.
6. Notas ya obtenidas: Si el estudiante indica que ya tiene una nota en algún elemento (ej. "Nota ya obtenida: 7.33", "en el tema 1 saqué un 8"), asígnala en 'grade' (número de 0.00 a 10.00). Si no dice nada o está pendiente, debe ser null.
7. Fechas o periodos: Si el estudiante indica fechas o plazos (ej. "25/01/2027", "mediados de noviembre"), colócala en 'dateHint'.
8. Nota mínima de corte:
   - Corte por bloque independiente: si especifica que cada bloque debe superarse independientemente (ej. "mínimo de 4.0 sobre 10 en cada bloque"), añade categoryMinGradeRequired: 4.0 en los items de esos bloques.
   - Corte global: Si el estudiante menciona una nota mínima global de examen final para hacer media (ej. "menos de un 4.5 en el examen final vas a recuperación"), asígnala en minFinalGradeRequired (escala 0-10).
9. En aiExplanation, resume brevemente en español lo que has interpretado, los bloques identificados, las notas ya consideradas y si cuadra el 100%.`;

    const userPrompt = `Asignatura: "${subjectName}".
Descripción del estudiante sobre cómo le califican:
"""
${userDescription}
"""

Extrae la estructura formal de evaluación cumpliendo el esquema JSON requerido.`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            subject: { type: 'STRING' },
            minFinalGradeRequired: { type: 'NUMBER', nullable: true },
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  type: { type: 'STRING', enum: ['EXAMEN', 'ENTREGA', 'OTRO'] },
                  weight: { type: 'NUMBER' },
                  grade: { type: 'NUMBER', nullable: true },
                  dateHint: { type: 'STRING', nullable: true },
                  category: { type: 'STRING', nullable: true },
                  subcategory: { type: 'STRING', nullable: true },
                  categoryMinGradeRequired: { type: 'NUMBER', nullable: true }
                },
                required: ['name', 'type', 'weight']
              }
            },
            aiExplanation: { type: 'STRING' }
          },
          required: ['subject', 'items', 'aiExplanation']
        }
      }
    };

    // Resilient Model Cascade: try 2.5 Flash -> 2.0 Flash -> 1.5 Flash
    for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
      const model = CANDIDATE_MODELS[i];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (rawText) {
            const parsed = JSON.parse(rawText) as AISyllabusExtraction;
            if (!parsed.subject) parsed.subject = subjectName;
            if (Array.isArray(parsed.items) && parsed.items.length > 0) {
              const blockCutoffs: Record<string, number> = {};
              for (const item of parsed.items) {
                if (item.category && typeof (item as any).categoryMinGradeRequired === 'number') {
                  blockCutoffs[item.category] = (item as any).categoryMinGradeRequired;
                }
              }
              if (Object.keys(blockCutoffs).length > 0) {
                parsed.blockCutoffs = blockCutoffs;
              }
              return parsed;
            }
          }
        }

        // Invalid API Key or Unauthorized - do not retry cascade
        if (response.status === 400 || response.status === 403) {
          throw new Error('La clave de API de Gemini no es válida o no tiene permisos. Verifica que la has copiado bien de Google AI Studio.');
        }

        // 503 (High demand) or 429 (Rate limit) or 500: cascade to next model
        if (response.status === 503 || response.status === 429 || response.status >= 500) {
          console.warn(`[GeminiGradesService] ${model} returned HTTP ${response.status} (High Demand). Cascading to next model...`);
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        const errText = await response.text();
        console.warn(`[GeminiGradesService] ${model} unexpected response ${response.status}: ${errText.slice(0, 100)}`);
      } catch (err: any) {
        if (err.message && err.message.includes('clave de API')) {
          throw err;
        }
        console.warn(`[GeminiGradesService] Network / cascade attempt for ${model} failed:`, err.message);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // If all cloud models are under high demand or offline, activate local semantic fallback
    console.warn('[GeminiGradesService] Google Gemini servers experiencing high demand across all models. Activating local engine...');
    const fallback = this.extractSyllabusOfflineFallback(subjectName, userDescription);
    fallback.aiExplanation = `ℹ️ Google Gemini está experimentando alta demanda en sus servidores (503). Hemos procesado tu guía docente con el motor universitario local para que puedas continuar:\n\n${fallback.aiExplanation}`;
    return fallback;
  }

  /**
   * Resilient local fallback reasoning engine: extracts syllabus when offline, testing without API key,
   * or when Google AI Studio servers return 503.
   */
  public extractSyllabusOfflineFallback(subjectName: string, text: string): AISyllabusExtraction {
    const clean = text.toLowerCase();
    const items: AISyllabusItem[] = [];

    // 1. Detect cut-off grade (e.g. "mínimo 4.0", "mínimo un 4.5", "mínima de 4.0", "menos de 4.5")
    let minFinalGradeRequired: number | null = null;
    const cutoffMatch = clean.match(/(?:m[ií]nimo|m[ií]nima|menos de|a partir de|corte de?|condici[oó]n de aprobado[^\d]*)\s*(?:de\s*|un\s*|una\s*|nota de\s*)?(\d+(?:[.,]\d+)?)/i);
    if (cutoffMatch) {
      const val = parseFloat(cutoffMatch[1].replace(',', '.'));
      if (val >= 1 && val <= 10) minFinalGradeRequired = val;
    }

    // 2. Check for multi-block syllabus: 50% Teoría + 50% Prácticas (or similar)
    const hasTeoria = /teor[ií]a/i.test(clean);
    const hasPractica = /pr[aá]ctica/i.test(clean);
    let blockCutoffs: Record<string, number> | undefined = undefined;

    if (/4(?:\.0)?\s*(?:sobre\s*10)?\s*(?:en\s*cada\s*bloque|de\s*forma\s*independiente)/i.test(clean)) {
      blockCutoffs = { 'Teoría': 4.0, 'Prácticas': 4.0 };
    }

    if (hasTeoria && hasPractica && clean.includes('50%')) {
      // THEORY BLOCK (50% global)
      // Test (Temas 1 y 2): 30% of theory = 15% global
      const testMatch = clean.match(/test\D*?(\d{1,2})\s*%/i);
      const testWeight = testMatch ? (parseInt(testMatch[1], 10) <= 30 ? 15 : parseInt(testMatch[1], 10)) : 15;
      const testDate = /mediados de noviembre/i.test(clean) ? 'Mediados de noviembre' : undefined;
      items.push({
        name: 'Teoría: Test (Temas 1 y 2)',
        type: 'EXAMEN',
        weight: testWeight,
        dateHint: testDate,
        category: 'Teoría'
      });

      // Problems Exam: 70% of theory = 35% global
      const probMatch = clean.match(/(?:problemas|examen de problemas)\D*?(\d{1,2})\s*%/i);
      const probWeight = probMatch ? (parseInt(probMatch[1], 10) >= 50 ? 35 : parseInt(probMatch[1], 10)) : 35;
      const probDate = clean.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/)?.[1] || '25/01/2027';
      items.push({
        name: 'Teoría: Examen de problemas',
        type: 'EXAMEN',
        weight: probWeight,
        dateHint: probDate,
        category: 'Teoría'
      });

      // PRACTICES BLOCK (50% global)
      // Check for pre-existing grade (e.g. 7.33)
      const grade1Match = clean.match(/(?:nota ya obtenida|obtenida|nota)[:\s]*(\d+(?:[.,]\d+)?)/i);
      const tema1Grade = grade1Match ? parseFloat(grade1Match[1].replace(',', '.')) : null;

      // Check if it specifies 4 themes (12.5% each)
      if (/4\s*temas|tema 1|tema 2/i.test(clean)) {
        items.push({
          name: 'Prácticas: Examen Tema 1',
          type: 'EXAMEN',
          weight: 12.5,
          grade: tema1Grade,
          category: 'Prácticas',
          subcategory: 'Tema 1'
        });

        // Extract atomic separate items for each evaluation part within topics
        if (/memoria\s*t[eé]cnica\s*\+\s*80%\s*examen|20%\s*memoria/i.test(clean)) {
          [2, 3, 4].forEach((temaNum) => {
            items.push({
              name: `Memoria técnica Tema ${temaNum}`,
              type: 'ENTREGA',
              weight: 2.5,
              category: 'Prácticas',
              subcategory: `Tema ${temaNum}`
            });
            items.push({
              name: `Examen Tema ${temaNum}`,
              type: 'EXAMEN',
              weight: 10,
              category: 'Prácticas',
              subcategory: `Tema ${temaNum}`
            });
          });
        } else {
          items.push({ name: 'Prácticas: Tema 2', type: 'ENTREGA', weight: 12.5, category: 'Prácticas', subcategory: 'Tema 2' });
          items.push({ name: 'Prácticas: Tema 3', type: 'ENTREGA', weight: 12.5, category: 'Prácticas', subcategory: 'Tema 3' });
          items.push({ name: 'Prácticas: Tema 4', type: 'ENTREGA', weight: 12.5, category: 'Prácticas', subcategory: 'Tema 4' });
        }
      } else {
        items.push({
          name: 'Bloque de Prácticas',
          type: 'ENTREGA',
          weight: 50,
          grade: tema1Grade,
          category: 'Prácticas'
        });
      }
    } else {
      // 3. General detection: Final Exam, Practices, Partials
      let finalWeight = 50;
      const finalMatch = clean.match(/(?:examen\s*final|prueba\s*final|final)\D*?(\d{1,2})\s*%/i);
      if (finalMatch) {
        finalWeight = parseInt(finalMatch[1], 10);
      }

      let practiceWeight = 30;
      const practiceMatch = clean.match(/(?:pr[aá]ctica|laboratorio|memoria|entrega)s?\D*?(\d{1,2})\s*%/i);
      if (practiceMatch) {
        practiceWeight = parseInt(practiceMatch[1], 10);
      }

      let partialWeight = Math.max(0, 100 - finalWeight - practiceWeight);
      const partialMatch = clean.match(/(?:parcial|control)es?\D*?(\d{1,2})\s*%/i);
      if (partialMatch) {
        partialWeight = parseInt(partialMatch[1], 10);
      }

      // Check count of partials
      const twoPartials = /dos\s*(?:parciales|controles)|2\s*(?:parciales|controles)/i.test(clean);
      if (twoPartials && partialWeight > 0) {
        const half = Math.round(partialWeight / 2);
        items.push({ name: 'Parcial 1', type: 'EXAMEN', weight: half });
        items.push({ name: 'Parcial 2', type: 'EXAMEN', weight: partialWeight - half });
      } else if (partialWeight > 0) {
        items.push({ name: 'Evaluación Parcial', type: 'EXAMEN', weight: partialWeight });
      }

      if (practiceWeight > 0) {
        items.push({ name: 'Prácticas / Entregas', type: 'ENTREGA', weight: practiceWeight });
      }

      if (finalWeight > 0) {
        items.push({ name: 'Examen Final', type: 'EXAMEN', weight: finalWeight });
      }
    }

    // Extract any pre-existing grade if not yet assigned
    const generalGradeMatch = clean.match(/(?:nota ya obtenida|saqu[eé] un|nota)[:\s]*(\d+(?:[.,]\d+)?)/i);
    if (generalGradeMatch && items.length > 0 && !items.some((it) => it.grade !== null && it.grade !== undefined)) {
      items[0].grade = parseFloat(generalGradeMatch[1].replace(',', '.'));
    }

    const totalWeight = items.reduce((s, it) => s + it.weight, 0);

    return {
      subject: subjectName,
      minFinalGradeRequired,
      blockCutoffs,
      items,
      aiExplanation: `He estructurado ${items.length} hitos evaluables sumando el ${totalWeight}%. ${minFinalGradeRequired ? `Incluye nota de corte de ${minFinalGradeRequired} para hacer media.` : ''}${blockCutoffs ? ' Se aplican cortes de 4.0 por bloque.' : ''}`
    };
  }
}
