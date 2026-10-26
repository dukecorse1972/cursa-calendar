# 🛡️ CONTRATOS DE ARQUITECTURA E IMPLEMENTACIONES INTOCABLES DE CURSA

> **ESTE DOCUMENTO ES LA FUENTE DE VERDAD TÉCNICA BASADA DIRECTAMENTE EN EL CÓDIGO FUENTE REAL.**
> **Cualquier cambio futuro en Cursa DEBE respetar estrictamente estos contratos. No simplificar, no eliminar demoras de red, no alterar selectores ni flujos sin verificar este documento.**

---

## 1. CREACIÓN DE EVENTOS ACADÉMICOS (`[EXAMEN]` / `[ENTREGA]`)

### 📍 Archivos involucrados:
- [`src/injected/ui/creatorModal.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/ui/creatorModal.ts)
- [`src/injected/adapter/GoogleCalendarAdapter.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/adapter/GoogleCalendarAdapter.ts)
- [`src/shared/formatters.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/shared/formatters.ts)
- [`src/main/window.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/main/window.ts)
- [`src/main/gcalAutomation.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/main/gcalAutomation.ts)

### ⚙️ Flujo Técnico Real:
1. **Modal de Usuario (`CreatorModal.handleSubmit`)**:
   - Valida `title`, `subject`, `date`, `startTime`, `endTime`.
   - Registra metadatos en `gcal_academic_meta`: `title`, `subject`, `type`, `description` y el `termKey` activo (`Y{year}-P{period}`).
   - Llama a `adapter.createAcademicEvent(payload)` vía API IPC `desktopApi.createAcademicEventBackground(payload)`.

2. **Proceso Principal Electron (`ipcMain.handle('create-academic-event-background')`)**:
   - Valida el payload con `validateAcademicEventPayload(payload)`.
   - Obtiene el índice de cuenta activa de Google (`getActiveAccountIndex()`, ej. `0` o `1`).
   - Genera la URL con `formatAcademicEvent(payload, accountIndex)`:
     `https://calendar.google.com/calendar/u/{index}/r/eventedit?text=[TIPO]+Asignatura+-+Titulo&dates=...&details=...`
   - Abre una ventana **headless en segundo plano** (`BrowserWindow` invisible, con la misma sesión de cookies `customSession` y `sandbox: true`).
   - Carga la URL y ejecuta `buildSaveEventScript(isEntrega)`.

3. **Script de Automatización en Segundo Plano (`buildSaveEventScript`)**:
   - **Localización del selector de Calendario**:
     - Utiliza `#xCalSel [role="combobox"]`, `RESILIENT_SELECTORS.calendarDropdownTrigger` y `aria-label*="Calendario"`.
     - **INTOCABLE**: Nunca usar un genérico `closest('[role="combobox"]')` en `spans` porque en `/r/eventedit` el primer combobox es la periodicidad (*"No se repite"*).
   - **Normalización de Texto NFD**:
     - Quita diacríticos/tildes con `normalize('NFD').replace(/[\u0300-\u036f]/g, '')`.
     - **INTOCABLE**: Esto es obligatorio para que el calendario `"Exámenes"` (con tilde) coincida con la búsqueda de `'examen'` o `'exam'`. Sin esto, Google Calendar guarda el examen en el calendario principal personal.
   - **Disparo de Clics Realistas**:
     - Utiliza `triggerRealisticClick` (`pointerdown`, `mousedown`, `focus`, `pointerup`, `mouseup`, `click`). Los botones Material 3 de Google ignoran los `.click()` sintéticos planos.
   - **Pulsación de Guardar**:
     - Localiza `#xSaveBu` o `button[aria-label*="Guardar"]` y lo pulsa con `triggerRealisticClick`.
   - **Retorno**:
     - Devuelve `{ selectedAcademicCalendar: boolean }`.

4. **Confirmación y Demora de Red (`window.ts`)**:
   - `waitForEventEditExit(bgWindow, 6500)` espera a que la URL salga de `/eventedit`.
   - **INTOCABLE (Demora de commit)**:
     ```ts
     await new Promise((r) => setTimeout(r, 650));
     ```
     Google Calendar cambia la URL en el cliente mediante `history.pushState` antes de que la petición HTTP `POST batchexecute/sync` termine de escribir en los servidores de Google. Si se destruye `bgWindow` de inmediato, Chromium aborta la conexión en vuelo y el evento no se guarda.
   - Solo tras los `650ms` se destruye `bgWindow`.

5. **Sincronización en la Ventana Visible (`mainWindow`)**:
   - `mainWindow` corre en un proceso renderer independiente cuyo almacén de eventos de Google Calendar está en memoria RAM. Un evento creado en una ventana invisible no aparece por arte de magia hasta que `mainWindow` solicita datos frescos a Google.
   - **INTOCABLE (`adapter.navigateToEventDate(date, toastMsg)`)**:
     - Guarda el mensaje de confirmación en `sessionStorage.setItem('gcal_pending_toast', ...)`.
     - Navega/recarga la vista de Google Calendar directamente a la fecha del evento (`/r/{modo_vista}/{año}/{mes}/{día}`).
     - Al cargar, `GoogleCalendarAdapter.init()`:
       1. Lee `AppState.getInstance().getState().activeTab` (que está en `ENTREGAS_EXAMENES`).
       2. Aplica `applyTabFilter('ENTREGAS_EXAMENES', true)`, asegurando que `Exámenes` y `Entregas` estén marcados.
       3. Consume `gcal_pending_toast` y muestra el toast flotante mientras el evento aparece en la cuadrícula.

---

## 2. ELIMINACIÓN DE EVENTOS ACADÉMICOS

### 📍 Archivos involucrados:
- [`src/injected/ui/detailModal.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/ui/detailModal.ts)
- [`src/injected/adapter/GoogleCalendarAdapter.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/adapter/GoogleCalendarAdapter.ts)
- [`src/main/window.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/main/window.ts)
- [`src/main/gcalAutomation.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/main/gcalAutomation.ts)

### ⚙️ Flujo Técnico Real:
1. **Acción del Usuario en Modal Detalle**:
   - El usuario pulsa `Quitar del todo` o `Eliminar evento`.
   - Se confirma con la tarjeta desplegable `#gcal-detail-delete-confirm`.
2. **Supresión Visual Instantánea (0ms) en la Cuadrícula**:
   - `adapter.markEventDeleted(eventId, title, subject)`:
     - Extrae el ID limpio: `cleanId = eventId.split(' ')[0].trim()`.
     - Añade a `deletedEventIds` y persiste en `gcal_deleted_events`.
     - Llama a `applyDeletedEventsCss()`:
       Inyecta en `<head>` una regla CSS forzada:
       ```css
       [data-eventid*="<id>"], [data-eventchip]:has([data-eventid*="<id>"]) {
         display: none !important;
         visibility: hidden !important;
         pointer-events: none !important;
         height: 0 !important;
         opacity: 0 !important;
       }
       ```
     - Elimina los nodos del DOM inmediatamente con animación suave.
     - **INTOCABLE**: Esto garantiza que, incluso si la memoria caché del SPA de Google Calendar intenta re-renderizar el chip mientras la petición de red ocurre, la tarjeta permanece 100% invisible para el alumno.
3. **Eliminación Real en la Nube (`delete-academic-event-background`)**:
   - Abre `BrowserWindow` invisible en `https://calendar.google.com/calendar/u/{accountIndex}/r/eventedit/{eventId}`.
   - Ejecuta `buildDeleteEventWindowScript()`:
     - Busca botón directo de eliminar (`RESILIENT_SELECTORS.deleteButton`) o menú `Más acciones` (`.BgYcDf`, `[aria-label*="Más acciones"]`).
     - Si está en `Más acciones`, despliega y busca el elemento `Eliminar` multilingüe (ES, EN, CA, GL, FR, DE).
     - Si aparece diálogo de confirmación de Google Calendar (`role="dialog"`), confirma automáticamente.
     - Espera a salir de `/r/eventedit/` o confirmación de toast.
     - Cierra la ventana invisible y confirma `{ success: true }`.

---

## 3. REPROGRAMACIÓN Y DESPLAZAMIENTO DE FECHA (`moveAcademicEvent`)

### 📍 Archivos involucrados:
- [`src/injected/ui/detailModal.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/ui/detailModal.ts)
- [`src/main/window.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/main/window.ts)
- [`src/main/gcalAutomation.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/main/gcalAutomation.ts)

### ⚙️ Flujo Técnico Real:
1. **Edición Atómica In-Place (`buildInPlaceRescheduleScript`)**:
   - Carga la URL de edición del evento existente.
   - Modifica los campos `dateInput`, `startTimeInput` y `endTimeInput` usando descriptores de propiedad nativos de HTMLInputElement para disparar los listeners internos de Google Calendar:
     ```js
     const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
     nativeInputSetter.call(el, val);
     el.dispatchEvent(new Event('input', { bubbles: true }));
     el.dispatchEvent(new Event('change', { bubbles: true }));
     ```
   - Pulsa Guardar con `triggerRealisticClick`.
   - Espera `500ms` tras salir de `/eventedit`.
2. **Fallback Seguro sin Duplicados**:
   - Si la edición in-place falla, **primero crea el evento nuevo** en la nueva fecha.
   - Solo tras confirmar que el nuevo evento está guardado, **procede a eliminar el original**.
   - **INTOCABLE**: Nunca eliminar el original antes de tener confirmado el nuevo; previene pérdida de datos ante caídas de red.
3. **Navegación al Destino**:
   - `adapter.navigateToEventDate(newIsoDate, toastMsg)` navega la ventana principal a la nueva fecha para que el alumno vea el evento desplazado.

---

## 4. FILTRADO DE CALENDARIOS Y PESTAÑAS (`CLASES` / `ENTREGAS_EXAMENES` / `TODO`)

### 📍 Archivos involucrados:
- [`src/injected/state.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/state.ts)
- [`src/injected/adapter/GoogleCalendarAdapter.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/adapter/GoogleCalendarAdapter.ts)

### ⚙️ Flujo Técnico Real:
1. **Doble Capa de Filtrado**:
   - **Capa 1: CSS Instantáneo (0ms)**:
     `document.body.setAttribute('data-gcal-tab', tab);`
     Oculta visualmente mediante CSS las filas de la barra lateral `.XXcuqd` según su `data-gcal-type` (`class`, `academic`, `other`, `birthday`).
   - **Capa 2: Sincronización de Checkboxes Nativos**:
     - En `CLASES`: Marca únicamente `isClass(name)`.
     - En `ENTREGAS_EXAMENES`: Marca únicamente `isAcademic(name)`.
       - **INTOCABLE (Fallback de cuenta sin calendarios secundarios)**:
         Si la cuenta no tiene creados los calendarios secundarios `Exámenes` y `Entregas` (`gcal_allow_primary_in_academic === 'true'`), mantiene marcado el calendario personal para que el alumno no pierda la visibilidad de sus entregas/exámenes.
     - En `TODO`: Marca todos los calendarios permitidos.
     - **Regla Estricta**: `Cumpleaños` (`isBirthday`) **NUNCA** se marca y permanece oculto si `gcal_hide_birthdays` está activo.
2. **Persistencia de Pestaña**:
   - `AppState.setActiveTab` persiste en `localStorage` e isolated storage (`gcal_active_tab`).
   - `GoogleCalendarAdapter.init()` inicializa `this.currentActiveTab = AppState.getInstance().getState().activeTab`.
   - **INTOCABLE**: Nunca forzar `currentActiveTab = 'CLASES'` en el constructor de `GoogleCalendarAdapter`; de lo contrario, cualquier recarga de página tras crear un evento devolvería al usuario a Clases y desmarcaría Exámenes.

---

## 5. AISLAMIENTO POR CUATRIMESTRES Y PLAN DE CARRERA

### 📍 Archivos involucrados:
- [`src/injected/services/academicPlanService.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/services/academicPlanService.ts)
- [`src/injected/adapter/GoogleCalendarAdapter.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/adapter/GoogleCalendarAdapter.ts)
- [`src/injected/ui/onboardingModal.ts`](file:///C:/Users/dario/Downloads/GoogleCalendarWIN/src/injected/ui/onboardingModal.ts)

### ⚙️ Flujo Técnico Real:
1. **Aislamiento Estricto de Materias**:
   - Al cambiar de cuatrimestre (`switchToTerm` o `advanceToNextTerm`):
     - El cuatrimestre saliente se guarda en `gcal_terms_archive` junto con sus asignaturas y notas.
     - Si el cuatrimestre entrante no tiene materias, se inicializa con `[]`.
     - `GoogleCalendarAdapter.getDetectedClasses()` devuelve exclusivamente las materias del cuatrimestre activo.
2. **Filtrado de Chips en la Cuadrícula (`enhanceAcademicChips`)**:
   - Un chip académico **SIEMPRE SE MUESTRA** en el cuatrimestre actual si:
     a) Fue creado explícitamente en el cuatrimestre activo (`cachedTermKey === activeTermKey`).
     b) Coincide con una de las asignaturas configuradas del periodo activo (`matchesActiveSubject`).
   - Un chip académico **SE OCULTA** (`data-gcal-inactive-term="true"`) si pertenece a otro cuatrimestre archivado o su asignatura no es del periodo actual.
3. **Estado de Periodo Completado (`isTermCompleted` / `setTermCompleted`)**:
   - **INTOCABLE**: Ningún periodo se marca en verde automáticamente por tener materias o por pasar de cuatrimestre.
   - Solo la pulsación explícita del botón `[○ Completado]` / `[✓ Completado]` conmuta la propiedad `completed` en el snapshot del archivo.
   - Se exporta y restaura fielmente en archivos `.cursa.json`.

---

## 6. RESUMEN DE REGLAS DE ORO ("INVIOLABLES")

| # | Regla Intocable | Razón Crítica |
|---|---|---|
| **R1** | **Normalizar diacríticos (NFD) al buscar el calendario `Exámenes`.** | En español *"exámenes"* lleva tilde. Si se busca *"examen"* sin normalizar, no coincide y el evento se envía al calendario personal oculto. |
| **R2** | **No buscar combobox por `closest('[role="combobox"]')` genérico en `/r/eventedit`.** | El primer combobox del formulario es la periodicidad (*"No se repite"*), no el calendario. |
| **R3** | **Mantener la espera de commit de `650ms` antes de destruir la ventana oculta de creación.** | Google Calendar emite `did-navigate-in-page` antes de finalizar el POST de red; destruir la ventana antes aborta la creación. |
| **R4** | **Navegar/recargar la ventana principal a la fecha del evento tras crearlo.** | Google Calendar mantiene los eventos en memoria RAM en un renderer separado; sin recarga/navegación no solicita los nuevos eventos al servidor. |
| **R5** | **Inicializar `currentActiveTab` desde `AppState.getState().activeTab`.** | Si se hardcodea `CLASES`, cualquier recarga de página (incluida la de creación de eventos) desmarca Exámenes y Entregas. |
| **R6** | **Suprimir chips borrados inmediatamente vía CSS forzado (`applyDeletedEventsCss`).** | Evita que la memoria caché del cliente de Google Calendar vuelva a pintar chips borrados. |
| **R7** | **Los eventos creados en el periodo activo (`cachedTermKey === activeTermKey`) nunca se marcan como inactivos.** | Garantiza que todo examen o entrega recién creado sea inmediatamente visible en la vista actual. |
| **R8** | **El estado verde de completado de un cuatrimestre es 100% manual vía botón.** | Ninguna acción automática debe marcar un periodo como completado; solo el alumno decide cuándo lo ha terminado. |
