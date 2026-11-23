import {
  AISyllabusExtraction,
  AISyllabusItem,
  GradesChatTurn,
  SubjectGradesConfig
} from '../../shared/gradesTypes';
import { getIsolatedItem, setIsolatedItem, removeIsolatedItem } from '../utils/storage';

const GEMINI_API_KEY_STORAGE_KEY = 'gcal_gemini_api_key';

// Cascade of models: starts with latest 2.5 Flash, falls back to 2.0 Flash and 1.5 Flash if 503 (high demand)
const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

const SYSTEM_PROMPT = `Eres el especialista sénior en evaluación y rendimiento académico universitario de Cursa.
Tu misión es interpretar cómo evalúa un profesor universitario a partir de explicaciones en lenguaje natural, guías docentes o correcciones conversacionales de un estudiante, y generar una estructura de notas impecable, atómica y matemáticamente exacta.

Reglas obligatorias:
1. Extrae todos los elementos evaluables concretos e individuales (ej. "Test (Temas 1 y 2)", "Examen de problemas", "Memoria técnica", "Examen práctico").
2. Clasifica el tipo en:
   - "EXAMEN": parciales, controles, exámenes teóricos, pruebas prácticas o examen final.
   - "ENTREGA": prácticas, memorias, proyectos, informes o ejercicios entregables.
   - "OTRO": asistencia, participación, seminarios, actitud o bonus.
3. Jerarquía limpia de Macro-Bloques ('category') y Subtemas ('subcategory'):
   - 'category': Macro-bloque principal de la asignatura (ej. "Teoría", "Prácticas", "Evaluación Continua", "Proyecto").
     IMPORTANTE: NUNCA pongas números de temas en 'category' (ej. NO uses "Tema 1" como category; agrúpalos bajo category: "Prácticas" y subcategory: "Tema 1").
   - 'subcategory': Si varios hitos pertenecen a un mismo tema/módulo dentro del bloque, asígnalo aquí (ej. "Tema 1", "Tema 2"). Si no aplica, usa null.
   - 'name': Nombre limpio del hito SIN repetir innecesariamente el nombre del bloque o del tema si ya están en category/subcategory.
4. Atomicidad y pesos globales exactos (0-100%):
   - NUNCA fusiones dos pruebas en un solo ítem (NUNCA "Memoria + Examen" ni "Test + Problemas"). Crea un ítem por cada evaluación.
   - Todos los 'weight' deben expresarse sobre la NOTA FINAL GLOBAL (0-100%). Si el estudiante da pesos relativos dentro de un bloque (ej. "Teoría vale 60%: Test 30% y Final 70%"), calcula los pesos globales exactos (Test = 18%, Final = 42%).
   - La suma total de todos los 'weight' debe ser EXACTAMENTE 100. Si falta o sobra, ajústalo lógicamente o indícalo en aiExplanation.
5. Notas de corte en 3 niveles (MUY IMPORTANTE — sepáralas con precisión):
   - Corte por ÍTEM individual ('minGradeRequired' en el ítem): Úsalo cuando el profesor exige nota mínima en una prueba concreta (ej. "mínimo 4.0 en el Examen de Problemas, el Test no tiene mínimo" -> pon minGradeRequired: 4.0 SOLO en "Examen de problemas", y null en "Test").
   - Corte por BLOQUE ('categoryMinGradeRequired' en los ítems del bloque): Úsalo cuando se exige nota mínima en el conjunto de un bloque (ej. "mínimo 4.0 en Teoría y 4.0 en Prácticas para hacer media").
   - Corte GLOBAL de examen final ('minFinalGradeRequired'): Úsalo SOLO si hay una regla genérica de mínimo en el examen final y no se ha especificado ya como minGradeRequired en un ítem concreto.
   - No inventes notas de corte que el estudiante no haya mencionado.
6. Notas ya obtenidas y fechas:
   - Si el estudiante menciona una nota ya obtenida (ej. "en el tema 1 saqué 7.33"), asígnala en 'grade' (0.00 a 10.00). Si está pendiente, null.
   - Si menciona fechas o plazos (ej. "25/01/2027", "mediados de noviembre"), ponlo en 'dateHint'.
7. Refinamiento multi-turno:
   - Si el estudiante pide modificar una propuesta anterior o su configuración actual (ej. "quita el corte del test", "cambia el peso de prácticas al 40%", "añade un tema 5"), devuelve la estructura COMPLETA actualizada respetando todo lo demás y conservando las notas previas.
8. En 'aiExplanation', resume en español claro y conciso (2-4 líneas): bloques detectados, cómo se aplican las notas de corte, notas previas conservadas y si suma 100%.`;

const RESPONSE_SCHEMA = {
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
          minGradeRequired: { type: 'NUMBER', nullable: true },
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
};

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
   * Single-turn convenience wrapper.
   */
  public async extractSyllabus(subjectName: string, userDescription: string): Promise<AISyllabusExtraction> {
    return this.extractSyllabusMultiTurn(subjectName, [{ role: 'user', text: userDescription }]);
  }

  /**
   * Multi-turn conversation extraction with Google Gemini Structured Outputs.
   * Accepts conversation history and optional existing subject configuration for incremental refinement.
   */
  public async extractSyllabusMultiTurn(
    subjectName: string,
    history: GradesChatTurn[],
    currentConfig?: SubjectGradesConfig | null
  ): Promise<AISyllabusExtraction> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const contextHeader = currentConfig && currentConfig.items.length > 0
      ? `Asignatura: "${subjectName}".\nConfiguración actual del estudiante (conservar notas ya obtenidas salvo indicación contraria):\n${JSON.stringify({
          minFinalGradeRequired: currentConfig.minFinalGradeRequired ?? null,
          blockCutoffs: currentConfig.blockCutoffs ?? {},
          items: currentConfig.items.map((it) => ({
            name: it.name,
            type: it.type,
            weight: it.weight,
            grade: it.grade,
            minGradeRequired: it.minGradeRequired ?? null,
            category: it.category ?? null,
            subcategory: it.subcategory ?? null,
            dateHint: it.dateHint ?? null
          }))
        })}\n\n`
      : `Asignatura: "${subjectName}".\n\n`;

    const contents = history.map((turn, idx) => ({
      role: turn.role,
      parts: [
        {
          text:
            idx === 0 && turn.role === 'user'
              ? `${contextHeader}Descripción del estudiante:\n"""\n${turn.text}\n"""\n\nExtrae la estructura formal de evaluación cumpliendo el esquema JSON requerido.`
              : turn.text
        }
      ]
    }));

    const payload = {
      contents,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA
      }
    };

    for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
      const model = CANDIDATE_MODELS[i];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 18000);
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

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

        if (response.status === 400 || response.status === 403) {
          throw new Error('La clave de API de Gemini no es válida o no tiene permisos. Verifica que la has copiado bien de Google AI Studio.');
        }

        if (response.status === 503 || response.status === 429 || response.status >= 500) {
          console.warn(`[GeminiGradesService] ${model} returned HTTP ${response.status}. Cascading to next model...`);
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        const errText = await response.text();
        console.warn(`[GeminiGradesService] ${model} unexpected response ${response.status}: ${errText.slice(0, 120)}`);
      } catch (err: any) {
        if (err.message && err.message.includes('clave de API')) {
          throw err;
        }
        console.warn(`[GeminiGradesService] Network / cascade attempt for ${model} failed:`, err.message);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Local semantic fallback using latest user text
    console.warn('[GeminiGradesService] All cloud models unavailable. Activating local engine...');
    const latestUserText = [...history].reverse().find((t) => t.role === 'user')?.text || '';
    const fallback = this.extractSyllabusOfflineFallback(subjectName, latestUserText);
    fallback.aiExplanation = `Google Gemini está con alta demanda temporal (503). Se ha procesado tu guía con el motor local:\n\n${fallback.aiExplanation}`;
    return fallback;
  }

  /**
   * Resilient local fallback reasoning engine: extracts syllabus when offline, testing without API key,
   * or when Google AI Studio servers return 503.
   */
  public extractSyllabusOfflineFallback(subjectName: string, text: string): AISyllabusExtraction {
    const clean = text.toLowerCase();
    const items: AISyllabusItem[] = [];

    // 1. Detect cut-off grade
    let minFinalGradeRequired: number | null = null;
    const cutoffMatch = clean.match(
      /(?:m[ií]nimo|m[ií]nima|menos de|a partir de|corte de?|condici[oó]n de aprobado[^\d]*)\s*(?:de\s*|un\s*|una\s*|nota de\s*)?(\d+(?:[.,]\d+)?)/i
    );
    if (cutoffMatch) {
      const val = parseFloat(cutoffMatch[1].replace(',', '.'));
      if (val >= 1 && val <= 10) minFinalGradeRequired = val;
    }

    // 2. Check for multi-block syllabus: Teoría + Prácticas (supports 50/50, 60/40, 70/30, etc.)
    const hasTeoria = /teor[ií]a/i.test(clean);
    const hasPractica = /pr[aá]ctica/i.test(clean);
    let blockCutoffs: Record<string, number> | undefined = undefined;

    const blockCutoffMatch = clean.match(
      /(\d+(?:[.,]\d+)?)\s*(?:sobre\s*10)?\s*(?:en\s*cada\s*bloque|de\s*forma\s*independiente)/i
    );
    if (blockCutoffMatch) {
      const bcVal = parseFloat(blockCutoffMatch[1].replace(',', '.'));
      if (bcVal >= 1 && bcVal <= 10) {
        blockCutoffs = { 'Teoría': bcVal, 'Prácticas': bcVal };
      }
    }

    const teoriaPctMatch = clean.match(/(?:(\d{1,2})\s*%\s*(?:de\s*)?teor[ií]a|teor[ií]a\D{0,15}(\d{1,2})\s*%)/i);
    const practicaPctMatch = clean.match(/(?:(\d{1,2})\s*%\s*(?:de\s*)?pr[aá]ctica|pr[aá]ctica[s]?\D{0,15}(\d{1,2})\s*%)/i);
    const teoriaWeightTotal = teoriaPctMatch ? parseInt(teoriaPctMatch[1] || teoriaPctMatch[2], 10) : 50;
    const practicaWeightTotal = practicaPctMatch ? parseInt(practicaPctMatch[1] || practicaPctMatch[2], 10) : 100 - teoriaWeightTotal;

    if (hasTeoria && hasPractica && (clean.includes('50%') || teoriaPctMatch || practicaPctMatch) && teoriaWeightTotal + practicaWeightTotal === 100) {
      // THEORY BLOCK
      if (/test|problemas/i.test(clean)) {
        const testMatch = clean.match(/test\D*?(\d{1,2})\s*%/i);
        const testRel = testMatch ? parseInt(testMatch[1], 10) : 30;
        const testWeight =
          teoriaWeightTotal === 50 && testRel <= 30
            ? Math.round((teoriaWeightTotal * testRel) / 100 * 10) / 10
            : Math.round(((teoriaWeightTotal * testRel) / 100) * 10) / 10;
        const testDate = /mediados de noviembre/i.test(clean) ? 'Mediados de noviembre' : undefined;
        items.push({
          name: 'Teoría: Test (Temas 1 y 2)',
          type: 'EXAMEN',
          weight: testWeight,
          dateHint: testDate,
          category: 'Teoría'
        });

        const probWeight = Math.round((teoriaWeightTotal - testWeight) * 10) / 10;
        const probDate = clean.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/)?.[1];
        items.push({
          name: 'Teoría: Examen de problemas',
          type: 'EXAMEN',
          weight: probWeight,
          dateHint: probDate,
          category: 'Teoría'
        });
      } else {
        const theoryDate = clean.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/)?.[1];
        items.push({
          name: 'Bloque de Teoría',
          type: 'EXAMEN',
          weight: teoriaWeightTotal,
          dateHint: theoryDate,
          category: 'Teoría'
        });
      }

      // PRACTICES BLOCK
      const grade1Match = clean.match(/(?:nota ya obtenida|obtenida|nota)[:\s]*(\d+(?:[.,]\d+)?)/i);
      const tema1Grade = grade1Match ? parseFloat(grade1Match[1].replace(',', '.')) : null;

      if (/4\s*temas|tema 1|tema 2/i.test(clean)) {
        const perTopic = Math.round((practicaWeightTotal / 4) * 100) / 100;
        items.push({
          name: 'Prácticas: Examen Tema 1',
          type: 'EXAMEN',
          weight: perTopic,
          grade: tema1Grade,
          category: 'Prácticas',
          subcategory: 'Tema 1'
        });

        if (/memoria\s*t[eé]cnica\s*\+\s*80%\s*examen|20%\s*memoria/i.test(clean)) {
          const memW = Math.round(perTopic * 0.2 * 100) / 100;
          const exW = Math.round((perTopic - memW) * 100) / 100;
          [2, 3, 4].forEach((temaNum) => {
            items.push({
              name: `Memoria técnica Tema ${temaNum}`,
              type: 'ENTREGA',
              weight: memW,
              category: 'Prácticas',
              subcategory: `Tema ${temaNum}`
            });
            items.push({
              name: `Examen Tema ${temaNum}`,
              type: 'EXAMEN',
              weight: exW,
              category: 'Prácticas',
              subcategory: `Tema ${temaNum}`
            });
          });
        } else {
          items.push({ name: 'Prácticas: Tema 2', type: 'ENTREGA', weight: perTopic, category: 'Prácticas', subcategory: 'Tema 2' });
          items.push({ name: 'Prácticas: Tema 3', type: 'ENTREGA', weight: perTopic, category: 'Prácticas', subcategory: 'Tema 3' });
          items.push({ name: 'Prácticas: Tema 4', type: 'ENTREGA', weight: perTopic, category: 'Prácticas', subcategory: 'Tema 4' });
        }
      } else {
        items.push({
          name: 'Bloque de Prácticas',
          type: 'ENTREGA',
          weight: practicaWeightTotal,
          grade: tema1Grade,
          category: 'Prácticas'
        });
      }
    } else {
      // 3. General detection: Final Exam, Practices, Partials (respecting only mentioned categories)
      const finalMatch = clean.match(/(?:examen\s*final|prueba\s*final|final)\D*?(\d{1,3})\s*%/i);
      const practiceMatch = clean.match(/(?:pr[aá]ctica|laboratorio|memoria|entrega|proyecto)s?\D*?(\d{1,3})\s*%/i);
      const partialMatch = clean.match(/(?:parcial|control|continua)es?\D*?(\d{1,3})\s*%/i);

      const hasAnyExplicitWeight = Boolean(finalMatch || practiceMatch || partialMatch);

      const mentionsFinal = Boolean(finalMatch) || /examen\s*final|prueba\s*final|\bfinal\b/i.test(clean);
      const mentionsPractice = Boolean(practiceMatch) || /pr[aá]ctica|laboratorio|memoria|entrega|proyecto/i.test(clean);
      const mentionsPartial = Boolean(partialMatch) || /parcial|control|continua/i.test(clean);

      let finalWeight = finalMatch ? parseInt(finalMatch[1], 10) : (hasAnyExplicitWeight ? 0 : 50);
      let practiceWeight = practiceMatch ? parseInt(practiceMatch[1], 10) : (hasAnyExplicitWeight ? 0 : 30);
      let partialWeight = partialMatch ? parseInt(partialMatch[1], 10) : (hasAnyExplicitWeight ? 0 : 20);

      const assignedSum = finalWeight + practiceWeight + partialWeight;
      if (hasAnyExplicitWeight && assignedSum < 100) {
        const remainder = 100 - assignedSum;
        if (!finalMatch && mentionsFinal) {
          finalWeight = remainder;
        } else if (!practiceMatch && mentionsPractice) {
          practiceWeight = remainder;
        } else if (!partialMatch && mentionsPartial) {
          partialWeight = remainder;
        }
      }

      const twoPartials = /dos\s*(?:parciales|controles)|2\s*(?:parciales|controles)/i.test(clean);
      if (twoPartials && partialWeight > 0) {
        const half = Math.round(partialWeight / 2);
        items.push({ name: 'Parcial 1', type: 'EXAMEN', weight: half, category: 'Evaluación Continua' });
        items.push({ name: 'Parcial 2', type: 'EXAMEN', weight: partialWeight - half, category: 'Evaluación Continua' });
      } else if (partialWeight > 0) {
        items.push({ name: 'Evaluación Parcial', type: 'EXAMEN', weight: partialWeight, category: 'Evaluación Continua' });
      }

      if (practiceWeight > 0) {
        items.push({ name: 'Prácticas / Entregas', type: 'ENTREGA', weight: practiceWeight, category: 'Prácticas' });
      }

      if (finalWeight > 0) {
        items.push({
          name: 'Examen Final',
          type: 'EXAMEN',
          weight: finalWeight,
          category: 'Examen Final',
          minGradeRequired: minFinalGradeRequired
        });
      }
    }

    const generalGradeMatch = clean.match(/(?:nota ya obtenida|saqu[eé] un|nota)[:\s]*(\d+(?:[.,]\d+)?)/i);
    if (generalGradeMatch && items.length > 0 && !items.some((it) => it.grade !== null && it.grade !== undefined)) {
      items[0].grade = parseFloat(generalGradeMatch[1].replace(',', '.'));
    }

    const totalWeight = Math.round(items.reduce((s, it) => s + it.weight, 0) * 10) / 10;

    return {
      subject: subjectName,
      minFinalGradeRequired,
      blockCutoffs,
      items,
      aiExplanation: `He estructurado ${items.length} hitos evaluables sumando el ${totalWeight}%. ${
        minFinalGradeRequired ? `Incluye nota de corte de ${minFinalGradeRequired} para hacer media.` : ''
      }${blockCutoffs ? ` Se aplican cortes independientes por bloque.` : ''}`
    };
  }
}
