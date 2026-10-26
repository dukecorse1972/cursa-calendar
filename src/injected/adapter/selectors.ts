/**
 * Resilient DOM Selector Strategies for Google Calendar
 * Uses cascade fallback: Semantic / ARIA attributes -> ID -> Minified Class -> Text heuristic
 */

export const RESILIENT_SELECTORS = {
  // Save button in event edit page (Multilingual: ES, EN, CA, GL, FR, DE)
  saveButton: [
    '#xSaveBu',
    'button[data-action="save"]',
    'button[aria-label*="Guardar" i]',
    'button[aria-label*="Save" i]',
    'button[aria-label*="Desa" i]',
    'button[aria-label*="Gardar" i]',
    'button[aria-label*="Enregistrer" i]',
    'button[aria-label*="Speichern" i]',
    '[role="button"][aria-label*="Guardar" i]',
    '[role="button"][aria-label*="Save" i]',
    '[role="button"][aria-label*="Desa" i]'
  ],

  // Delete button in event edit page (Multilingual: ES, EN, CA, GL, FR, DE)
  deleteButton: [
    '#xDelBu',
    'button[data-action="delete"]',
    'button[aria-label*="Eliminar evento" i]',
    'button[aria-label*="Delete event" i]',
    'button[aria-label="Eliminar" i]',
    'button[aria-label="Delete" i]',
    'button[aria-label="Suprimeix" i]',
    'button[aria-label="Supprimer" i]',
    'button[aria-label="Löschen" i]',
    '[role="button"][aria-label*="Eliminar evento" i]',
    '[role="button"][aria-label*="Delete event" i]',
    '[role="button"][aria-label="Eliminar" i]',
    '[role="button"][aria-label="Delete" i]',
    '[role="button"][aria-label="Suprimeix" i]'
  ],

  // Description input/textarea in event edit page
  descriptionInput: [
    '[role="textbox"][aria-label*="descripci" i]',
    '[role="textbox"][aria-label*="description" i]',
    'textarea[aria-label*="descripci" i]',
    'textarea[aria-label*="description" i]',
    '#xDescIn',
    'div[contenteditable="true"][aria-label*="descripci" i]',
    'div[contenteditable="true"]'
  ],

  // Date and Time inputs in event edit page
  startDateInput: [
    'input[aria-label*="Fecha de inicio" i]',
    'input[aria-label*="Start date" i]',
    'input[aria-label*="Data d\'inici" i]',
    'input[aria-label*="Date de début" i]',
    'input[aria-label*="Startdatum" i]',
    '#xDateIn'
  ],
  startTimeInput: [
    'input[aria-label*="Hora de inicio" i]',
    'input[aria-label*="Start time" i]',
    'input[aria-label*="Hora d\'inici" i]',
    'input[aria-label*="Heure de début" i]',
    'input[aria-label*="Startzeit" i]'
  ],
  endTimeInput: [
    'input[aria-label*="Hora de finalización" i]',
    'input[aria-label*="End time" i]',
    'input[aria-label*="Hora de finalització" i]',
    'input[aria-label*="Heure de fin" i]',
    'input[aria-label*="Endzeit" i]'
  ],

  // More actions button trigger in event edit page
  moreActionsButton: [
    '.BgYcDf button',
    '.BgYcDf [role="button"]',
    'button.xDYJ0e',
    'button[aria-haspopup="menu"]',
    'button[aria-label*="Más acciones" i]',
    'button[aria-label*="Mas acciones" i]',
    'button[aria-label*="More actions" i]',
    'button[aria-label*="Més accions" i]',
    'button[aria-label*="Máis accións" i]',
    'button[aria-label*="Plus d\'actions" i]',
    'button[aria-label*="Weitere Aktionen" i]',
    '[role="button"][aria-label*="Más acciones" i]',
    '[role="button"][aria-label*="Mas acciones" i]',
    '[role="button"][aria-label*="More actions" i]',
    '[role="button"].xDYJ0e'
  ],

  // Delete option inside More actions dropdown menu
  deleteMenuItem: [
    '.BgYcDf [role="menuitem"]',
    '.BgYcDf li',
    '[role="menuitem"][jsname="VkLyEc"]',
    'li[jsname="VkLyEc"]',
    '[role="menuitem"][aria-label*="Eliminar" i]',
    '[role="menuitem"][aria-label*="Delete" i]',
    '.goog-menuitem[aria-label*="Eliminar" i]',
    '.goog-menuitem[aria-label*="Delete" i]'
  ],

  // Calendar select dropdown in event edit page
  calendarDropdownTrigger: [
    '.haAclf',
    '[role="combobox"][aria-label*="Calendario" i]',
    '[role="combobox"][aria-label*="Calendar" i]',
    '[role="listbox"][aria-label*="Calendario" i]'
  ],

  // Options inside calendar dropdown
  calendarOption: [
    '[role="option"]',
    '[role="menuitem"]',
    '[data-value]'
  ],

  // Calendar row in left sidebar
  calendarRow: [
    '.XXcuqd',
    'li:has([role="checkbox"])',
    'div:has(> [role="checkbox"])',
    '[role="treeitem"]:has([role="checkbox"])'
  ],

  // Native event chips in calendar grid
  eventChip: [
    '[data-eventchip]',
    '[role="button"][data-eventid]',
    'div[data-chip]'
  ],

  // Top header button to create event
  createButton: [
    '[jsname="FAC3ob"]',
    '[data-action="create"]',
    'button:has([aria-label*="Crear" i])',
    'div[role="button"]:has([aria-label*="Crear" i])'
  ],

  // Top header mount targets for academic tabs (cascade order)
  headerMountTargets: [
    '.gb_v',
    '.gb_ae',
    'header input[type="text"]',
    'header form',
    'header button[aria-label*="Configuración" i]',
    'header button[aria-label*="Settings" i]',
    'header',
    'div[role="banner"]'
  ]
};

