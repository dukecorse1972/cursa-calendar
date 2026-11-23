/**
 * Dedicated stylesheet for the Cursa Grades Simulator v2.
 * Supports both Dark and Light themes cleanly using ThemeManager tokens + semantic surface tokens.
 */

export const GRADES_STYLES_ID = 'cursa-grades-v2-styles';

export function injectGradesStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(GRADES_STYLES_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = GRADES_STYLES_ID;
    document.head.appendChild(style);
  }

  style.textContent = `
    /* ===== Theme Tokens (Adaptive Light & Dark) ===== */
    #cursa-grades-view-root,
    #cursa-grades-chat-modal-overlay {
      color-scheme: light;
      --cg-bg: #f6f8fa;
      --cg-surface: #ffffff;
      --cg-surface-2: #f1f3f5;
      --cg-border: var(--gcal-border, #e0e3e7);
      --cg-border-subtle: rgba(128, 134, 139, 0.16);
      --cg-text: var(--gcal-text, #1f1f1f);
      --cg-muted: var(--gcal-secondary-text, #5f6368);
      --cg-accent: var(--gcal-accent, #1a73e8);
      --cg-accent-soft: rgba(26, 115, 232, 0.10);
      --cg-accent-border: rgba(26, 115, 232, 0.28);

      --cg-success: #188038;
      --cg-success-soft: rgba(24, 128, 56, 0.10);
      --cg-success-border: rgba(24, 128, 56, 0.28);

      --cg-warn: #b06000;
      --cg-warn-soft: rgba(234, 134, 0, 0.12);
      --cg-warn-border: rgba(234, 134, 0, 0.30);

      --cg-danger: #c5221f;
      --cg-danger-soft: rgba(197, 34, 31, 0.10);
      --cg-danger-border: rgba(197, 34, 31, 0.28);

      --cg-sim: #7c3aed;
      --cg-sim-soft: rgba(124, 58, 237, 0.10);
      --cg-sim-border: rgba(124, 58, 237, 0.34);

      --cg-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
      --cg-shadow-md: 0 6px 20px rgba(0, 0, 0, 0.08);
      --cg-font: 'Google Sans', 'Google Sans Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #cursa-grades-view-root[data-cg-theme="dark"],
    #cursa-grades-chat-modal-overlay[data-cg-theme="dark"],
    [data-gcal-theme="dark"] #cursa-grades-view-root,
    [data-gcal-theme="dark"] #cursa-grades-chat-modal-overlay,
    body.dark-theme #cursa-grades-view-root {
      color-scheme: dark;
      --cg-bg: var(--gcal-bg, #18191b);
      --cg-surface: var(--gcal-surface, #212326);
      --cg-surface-2: var(--gcal-surface-hover, #2b2e33);
      --cg-border: var(--gcal-border, #34373d);
      --cg-border-subtle: rgba(255, 255, 255, 0.07);
      --cg-text: var(--gcal-text, #eceff4);
      --cg-muted: var(--gcal-secondary-text, #9aa0a6);
      --cg-accent: var(--gcal-accent, #8ab4f8);
      --cg-accent-soft: rgba(138, 180, 248, 0.12);
      --cg-accent-border: rgba(138, 180, 248, 0.30);

      --cg-success: #81c995;
      --cg-success-soft: rgba(129, 201, 149, 0.13);
      --cg-success-border: rgba(129, 201, 149, 0.30);

      --cg-warn: #fdd663;
      --cg-warn-soft: rgba(253, 214, 99, 0.13);
      --cg-warn-border: rgba(253, 214, 99, 0.30);

      --cg-danger: #f28b82;
      --cg-danger-soft: rgba(242, 139, 130, 0.14);
      --cg-danger-border: rgba(242, 139, 130, 0.32);

      --cg-sim: #c4b5fd;
      --cg-sim-soft: rgba(167, 139, 250, 0.15);
      --cg-sim-border: rgba(167, 139, 250, 0.42);

      --cg-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.24);
      --cg-shadow-md: 0 10px 30px rgba(0, 0, 0, 0.38);
    }

    /* ===== Root Container ===== */
    #cursa-grades-view-root {
      width: 100%;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      background: var(--cg-bg);
      color: var(--cg-text);
      font-family: var(--cg-font);
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }

    .cg-shell {
      max-width: 1240px;
      margin: 0 auto;
      padding: 20px 28px 72px 28px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      box-sizing: border-box;
    }

    .cg-num {
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
    }

    /* Hide native number spinners */
    #cursa-grades-view-root input[type="number"]::-webkit-outer-spin-button,
    #cursa-grades-view-root input[type="number"]::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    #cursa-grades-view-root input[type="number"] {
      -moz-appearance: textfield;
    }

    /* ===== Top Navigation Rail ===== */
    .cg-nav-rail {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 0 6px 0;
      scrollbar-width: none;
    }
    .cg-nav-rail::-webkit-scrollbar { display: none; }

    .cg-term-pill {
      height: 34px;
      padding: 0 12px;
      border-radius: 10px;
      border: 1px solid var(--cg-border);
      background: var(--cg-surface);
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 12.5px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .cg-term-pill:hover {
      background: var(--cg-surface-2);
      border-color: var(--cg-accent-border);
    }
    .cg-term-pill.done {
      border-color: var(--cg-success-border);
      background: var(--cg-success-soft);
      color: var(--cg-success);
    }

    .cg-nav-divider {
      width: 1px;
      height: 20px;
      background: var(--cg-border);
      flex-shrink: 0;
      margin: 0 2px;
    }

    .cg-tab {
      height: 34px;
      padding: 0 13px;
      border-radius: 10px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--cg-muted);
      font-family: var(--cg-font);
      font-size: 13px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .cg-tab:hover {
      background: var(--cg-surface-2);
      color: var(--cg-text);
    }
    .cg-tab.active {
      background: var(--cg-surface);
      border-color: var(--cg-border);
      color: var(--cg-text);
      font-weight: 600;
      box-shadow: var(--cg-shadow-sm);
    }

    .cg-tab-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .cg-tab-score {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--cg-surface-2);
      color: var(--cg-muted);
      font-variant-numeric: tabular-nums;
    }
    .cg-tab.active .cg-tab-score {
      background: var(--cg-accent-soft);
      color: var(--cg-accent);
    }

    /* ===== Subject Header ===== */
    .cg-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 16px 20px;
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 16px;
      box-shadow: var(--cg-shadow-sm);
    }

    .cg-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .cg-subject-accent {
      width: 4px;
      height: 40px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .cg-subject-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .cg-subject-title {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--cg-text);
      line-height: 1.2;
    }

    .cg-ects-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 8px;
      background: var(--cg-surface-2);
      border: 1px solid var(--cg-border-subtle);
      color: var(--cg-muted);
      font-size: 11.5px;
      font-weight: 600;
    }
    .cg-ects-input {
      width: 30px;
      background: transparent;
      border: none;
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 11.5px;
      font-weight: 600;
      text-align: center;
      outline: none;
      padding: 0;
    }

    .cg-subject-subtitle {
      font-size: 12.5px;
      color: var(--cg-muted);
      margin-top: 3px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cg-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* ===== Buttons ===== */
    .cg-btn {
      height: 34px;
      padding: 0 13px;
      border-radius: 10px;
      border: 1px solid var(--cg-border);
      background: var(--cg-surface);
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 12.5px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    }
    .cg-btn:hover {
      background: var(--cg-surface-2);
    }

    .cg-btn-primary {
      background: var(--cg-accent);
      border-color: transparent;
      color: #ffffff;
      font-weight: 600;
    }
    [data-gcal-theme="dark"] .cg-btn-primary {
      color: #111317;
    }
    .cg-btn-primary:hover {
      background: var(--cg-accent);
      opacity: 0.92;
    }

    .cg-btn-ai {
      background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
      border-color: transparent;
      color: #ffffff;
      font-weight: 600;
    }
    .cg-btn-ai:hover {
      opacity: 0.92;
      background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
    }

    .cg-btn-ghost {
      border-color: transparent;
      background: transparent;
      color: var(--cg-muted);
    }
    .cg-btn-ghost:hover {
      background: var(--cg-surface-2);
      color: var(--cg-text);
    }

    .cg-btn-danger-ghost {
      border-color: transparent;
      background: transparent;
      color: var(--cg-muted);
      width: 34px;
      padding: 0;
      justify-content: center;
    }
    .cg-btn-danger-ghost:hover {
      background: var(--cg-danger-soft);
      color: var(--cg-danger);
    }

    .cg-btn-sm {
      height: 28px;
      padding: 0 10px;
      font-size: 11.5px;
      border-radius: 8px;
    }

    /* ===== Badges & Pills ===== */
    .cg-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1.3;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .cg-pill-success { background: var(--cg-success-soft); color: var(--cg-success); border-color: var(--cg-success-border); }
    .cg-pill-warn { background: var(--cg-warn-soft); color: var(--cg-warn); border-color: var(--cg-warn-border); }
    .cg-pill-danger { background: var(--cg-danger-soft); color: var(--cg-danger); border-color: var(--cg-danger-border); }
    .cg-pill-accent { background: var(--cg-accent-soft); color: var(--cg-accent); border-color: var(--cg-accent-border); }
    .cg-pill-sim { background: var(--cg-sim-soft); color: var(--cg-sim); border-color: var(--cg-sim-border); }
    .cg-pill-neutral { background: var(--cg-surface-2); color: var(--cg-muted); border-color: var(--cg-border-subtle); }

    /* ===== Bento KPI Strip (3 Clean Cards) ===== */
    .cg-kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    @media (max-width: 960px) {
      .cg-kpi-grid { grid-template-columns: 1fr; }
    }

    .cg-card {
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 16px;
      padding: 16px 18px;
      box-shadow: var(--cg-shadow-sm);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }

    .cg-card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .cg-card-label {
      font-size: 11.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--cg-muted);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .cg-big-value {
      font-size: 30px;
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: -0.03em;
      color: var(--cg-text);
      font-variant-numeric: tabular-nums;
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .cg-big-unit {
      font-size: 13px;
      font-weight: 500;
      color: var(--cg-muted);
      letter-spacing: 0;
    }

    .cg-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--cg-muted);
      flex-wrap: wrap;
    }
    .cg-meta-row strong {
      color: var(--cg-text);
      font-weight: 600;
    }

    /* Segmented Progress Bar */
    .cg-progress-track {
      width: 100%;
      height: 7px;
      background: var(--cg-surface-2);
      border-radius: 999px;
      overflow: hidden;
      position: relative;
      display: flex;
    }
    .cg-progress-seg {
      height: 100%;
      transition: width 0.25s ease;
    }
    .cg-progress-marker {
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 1.5px;
      background: var(--cg-text);
      opacity: 0.25;
      pointer-events: none;
    }

    /* Target Segmented Switcher */
    .cg-seg-group {
      display: inline-flex;
      background: var(--cg-surface-2);
      padding: 2px;
      border-radius: 9px;
      border: 1px solid var(--cg-border-subtle);
      gap: 2px;
    }
    .cg-seg-btn {
      border: none;
      background: transparent;
      color: var(--cg-muted);
      font-family: var(--cg-font);
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.15s ease;
      font-variant-numeric: tabular-nums;
    }
    .cg-seg-btn:hover { color: var(--cg-text); }
    .cg-seg-btn.active {
      background: var(--cg-surface);
      color: var(--cg-accent);
      box-shadow: var(--cg-shadow-sm);
    }

    /* Range Slider */
    .cg-slider {
      width: 100%;
      height: 5px;
      border-radius: 999px;
      accent-color: var(--cg-sim);
      cursor: pointer;
    }

    /* ===== Cutoff Diagnostics Strip ===== */
    .cg-cutoffs-strip {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 14px;
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 12px;
    }
    .cg-cutoffs-title {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--cg-muted);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-right: 4px;
    }

    /* ===== Evaluation Tree Toolbar ===== */
    .cg-tree-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 2px 2px;
    }

    .cg-tree-toolbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .cg-section-title {
      font-size: 14.5px;
      font-weight: 600;
      color: var(--cg-text);
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .cg-tree-toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cg-inline-field {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      height: 30px;
      border-radius: 9px;
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      font-size: 12px;
      color: var(--cg-muted);
    }
    .cg-inline-field input {
      width: 44px;
      border: none;
      background: transparent;
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      outline: none;
      font-variant-numeric: tabular-nums;
    }

    /* ===== Block Card ===== */
    .cg-blocks-stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .cg-block {
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: var(--cg-shadow-sm);
    }

    .cg-block-header {
      padding: 13px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      background: var(--cg-surface);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
    }
    .cg-block-header:hover {
      background: var(--cg-surface-2);
    }
    .cg-block.expanded .cg-block-header {
      border-bottom: 1px solid var(--cg-border-subtle);
    }

    .cg-block-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .cg-chevron {
      color: var(--cg-muted);
      display: inline-flex;
      transition: transform 0.18s ease;
    }
    .cg-block:not(.expanded) .cg-chevron {
      transform: rotate(-90deg);
    }

    .cg-block-name-input {
      font-family: var(--cg-font);
      font-size: 15px;
      font-weight: 600;
      color: var(--cg-text);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 2px 6px;
      margin: -2px -6px;
      outline: none;
      min-width: 80px;
      max-width: 240px;
    }
    .cg-block-name-input:hover {
      border-color: var(--cg-border);
    }
    .cg-block-name-input:focus {
      background: var(--cg-bg);
      border-color: var(--cg-accent);
    }

    .cg-block-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .cg-block-metrics {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--cg-muted);
    }
    .cg-block-metric {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-variant-numeric: tabular-nums;
    }
    .cg-block-metric strong {
      color: var(--cg-text);
      font-weight: 600;
    }

    .cg-block-bar {
      height: 3px;
      width: 100%;
      background: var(--cg-surface-2);
    }
    .cg-block-bar-fill {
      height: 100%;
      background: var(--cg-accent);
      transition: width 0.25s ease;
    }

    .cg-block-body {
      padding: 10px 14px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ===== Column Headers ===== */
    .cg-col-headers {
      display: grid;
      grid-template-columns: 88px minmax(180px, 1fr) 86px 76px 130px 76px 28px;
      gap: 10px;
      padding: 4px 10px 6px 10px;
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--cg-muted);
      border-bottom: 1px solid var(--cg-border-subtle);
    }
    .cg-col-headers .right { text-align: right; }
    .cg-col-headers .center { text-align: center; }

    /* ===== Subtopic Group ===== */
    .cg-subtopic {
      margin-top: 4px;
      padding-left: 12px;
      border-left: 2px solid var(--cg-accent-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cg-subtopic-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 5px 10px;
      border-radius: 8px;
      background: var(--cg-surface-2);
    }

    .cg-subtopic-name-input {
      font-family: var(--cg-font);
      font-size: 13px;
      font-weight: 600;
      color: var(--cg-text);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 1px 6px;
      outline: none;
      width: 140px;
    }
    .cg-subtopic-name-input:focus {
      background: var(--cg-surface);
      border-color: var(--cg-accent);
    }

    /* ===== Aligned Item Row ===== */
    .cg-row {
      display: grid;
      grid-template-columns: 88px minmax(180px, 1fr) 86px 76px 130px 76px 28px;
      gap: 10px;
      align-items: center;
      padding: 7px 10px;
      border-radius: 10px;
      border: 1px solid transparent;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .cg-row:hover {
      background: var(--cg-surface-2);
      border-color: var(--cg-border-subtle);
    }
    .cg-row.has-sim {
      background: var(--cg-sim-soft);
      border-color: var(--cg-sim-border);
    }
    .cg-row.cutoff-failed {
      background: var(--cg-danger-soft);
      border-color: var(--cg-danger-border);
    }

    @media (max-width: 960px) {
      .cg-col-headers { display: none; }
      .cg-row {
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        border-color: var(--cg-border-subtle);
        padding: 10px;
      }
    }

    /* Type pill button (click cycles EXAMEN -> ENTREGA -> OTRO) */
    .cg-type-pill {
      height: 26px;
      padding: 0 8px;
      border-radius: 7px;
      border: 1px solid var(--cg-border-subtle);
      background: var(--cg-surface-2);
      font-family: var(--cg-font);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .cg-type-pill.EXAMEN { color: var(--cg-accent); background: var(--cg-accent-soft); border-color: var(--cg-accent-border); }
    .cg-type-pill.ENTREGA { color: var(--cg-success); background: var(--cg-success-soft); border-color: var(--cg-success-border); }
    .cg-type-pill.OTRO { color: var(--cg-warn); background: var(--cg-warn-soft); border-color: var(--cg-warn-border); }

    .cg-name-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .cg-name-input {
      flex: 1;
      min-width: 80px;
      font-family: var(--cg-font);
      font-size: 13.5px;
      font-weight: 500;
      color: var(--cg-text);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 4px 7px;
      outline: none;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .cg-name-input:hover {
      border-color: var(--cg-border-subtle);
    }
    .cg-name-input:focus {
      background: var(--cg-bg);
      border-color: var(--cg-accent);
    }

    .cg-cal-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 500;
      max-width: 145px;
      flex-shrink: 0;
      border: 1px solid var(--cg-success-border);
      background: var(--cg-success-soft);
      color: var(--cg-success);
    }
    .cg-cal-chip span.txt {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cg-cal-unlink {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      opacity: 0.75;
    }
    .cg-cal-unlink:hover { opacity: 1; }

    .cg-cal-link-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 7px;
      border-radius: 7px;
      border: 1px dashed var(--cg-border);
      background: transparent;
      color: var(--cg-muted);
      font-family: var(--cg-font);
      font-size: 11px;
      cursor: pointer;
      flex-shrink: 0;
      opacity: 0.65;
      transition: all 0.15s ease;
    }
    .cg-row:hover .cg-cal-link-btn { opacity: 1; }
    .cg-cal-link-btn:hover {
      border-color: var(--cg-accent);
      color: var(--cg-accent);
      background: var(--cg-accent-soft);
    }

    .cg-date-hint {
      font-size: 11px;
      color: var(--cg-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* Weight Cell */
    .cg-weight-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 3px;
    }
    .cg-num-input {
      width: 52px;
      height: 30px;
      padding: 0 7px;
      border-radius: 8px;
      border: 1px solid var(--cg-border);
      background: var(--cg-bg);
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 12.5px;
      font-weight: 600;
      text-align: right;
      outline: none;
      font-variant-numeric: tabular-nums;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .cg-num-input:focus {
      border-color: var(--cg-accent);
      box-shadow: 0 0 0 2px var(--cg-accent-soft);
    }
    .cg-unit-suffix {
      font-size: 11px;
      color: var(--cg-muted);
      font-weight: 500;
    }

    /* Cutoff Cell */
    .cg-cutoff-input {
      width: 56px;
      height: 30px;
      padding: 0 6px;
      border-radius: 8px;
      border: 1px solid var(--cg-border-subtle);
      background: transparent;
      color: var(--cg-muted);
      font-family: var(--cg-font);
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      outline: none;
      font-variant-numeric: tabular-nums;
      transition: all 0.15s ease;
    }
    .cg-cutoff-input.active {
      border-color: var(--cg-warn-border);
      background: var(--cg-warn-soft);
      color: var(--cg-warn);
    }
    .cg-cutoff-input:focus {
      border-color: var(--cg-accent);
      background: var(--cg-bg);
      color: var(--cg-text);
    }

    /* Grade / What-If Dual Cell */
    .cg-grade-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
    }
    .cg-grade-input {
      width: 68px;
      height: 30px;
      padding: 0 8px;
      border-radius: 8px;
      border: 1.5px solid var(--cg-border);
      background: var(--cg-bg);
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 13px;
      font-weight: 600;
      text-align: right;
      outline: none;
      font-variant-numeric: tabular-nums;
      transition: all 0.15s ease;
    }
    .cg-grade-input.graded {
      border-color: var(--cg-accent-border);
      background: var(--cg-accent-soft);
      color: var(--cg-accent);
    }
    .cg-grade-input.simulated {
      border-style: dashed;
      border-color: var(--cg-sim-border);
      background: var(--cg-sim-soft);
      color: var(--cg-sim);
    }
    .cg-grade-input:focus {
      border-color: var(--cg-accent);
      border-style: solid;
      box-shadow: 0 0 0 2px var(--cg-accent-soft);
    }

    .cg-sim-toggle-btn {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--cg-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }
    .cg-sim-toggle-btn:hover {
      background: var(--cg-sim-soft);
      color: var(--cg-sim);
    }
    .cg-sim-toggle-btn.active {
      background: var(--cg-sim-soft);
      border-color: var(--cg-sim-border);
      color: var(--cg-sim);
    }

    .cg-contrib-cell {
      text-align: right;
      font-size: 12.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--cg-muted);
    }
    .cg-contrib-cell.graded { color: var(--cg-success); }
    .cg-contrib-cell.simulated { color: var(--cg-sim); }

    .cg-row-del-btn {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--cg-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.4;
      transition: all 0.15s ease;
    }
    .cg-row:hover .cg-row-del-btn { opacity: 1; }
    .cg-row-del-btn:hover {
      background: var(--cg-danger-soft);
      color: var(--cg-danger);
    }

    /* ===== Weight Footer ===== */
    .cg-weight-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px 16px;
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 14px;
      font-size: 12.5px;
    }

    /* ===== Inline Confirm Bar ===== */
    .cg-confirm-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      border-radius: 12px;
      background: var(--cg-danger-soft);
      border: 1px solid var(--cg-danger-border);
      color: var(--cg-danger);
      font-size: 13px;
      font-weight: 500;
    }

    /* ===== Term Overview Grid ===== */
    .cg-overview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 14px;
    }
    .cg-overview-card {
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 16px;
      padding: 16px 18px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .cg-overview-card:hover {
      transform: translateY(-2px);
      border-color: var(--cg-accent-border);
      box-shadow: var(--cg-shadow-md);
    }

    /* ===== Empty State ===== */
    .cg-empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 56px 28px;
      background: var(--cg-surface);
      border: 1px solid var(--cg-border);
      border-radius: 20px;
      gap: 14px;
    }
    .cg-empty-icon {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: var(--cg-accent-soft);
      border: 1px solid var(--cg-accent-border);
      color: var(--cg-accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ===== Chat Modal ===== */
    #cursa-grades-chat-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 17, 21, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: var(--cg-font);
      box-sizing: border-box;
    }

    .cg-chat-card {
      background: var(--cg-surface);
      color: var(--cg-text);
      border: 1px solid var(--cg-border);
      border-radius: 20px;
      width: 720px;
      max-width: 94vw;
      height: 650px;
      max-height: 92vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--cg-shadow-md);
      overflow: hidden;
    }

    .cg-chat-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--cg-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .cg-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .cg-chat-bubble-bot {
      background: var(--cg-surface-2);
      border: 1px solid var(--cg-border-subtle);
      color: var(--cg-text);
      padding: 14px 16px;
      border-radius: 16px;
      border-top-left-radius: 4px;
      font-size: 13.5px;
      line-height: 1.55;
      max-width: 88%;
    }

    .cg-chat-bubble-user {
      background: var(--cg-accent-soft);
      border: 1px solid var(--cg-accent-border);
      color: var(--cg-text);
      padding: 10px 14px;
      border-radius: 16px;
      border-top-right-radius: 4px;
      font-size: 13.5px;
      line-height: 1.5;
      max-width: 82%;
      white-space: pre-wrap;
    }

    .cg-chat-input-bar {
      padding: 12px 16px;
      border-top: 1px solid var(--cg-border);
      display: flex;
      align-items: flex-end;
      gap: 10px;
      background: var(--cg-surface);
    }

    .cg-chat-textarea {
      flex: 1;
      min-height: 40px;
      max-height: 130px;
      padding: 9px 14px;
      border-radius: 14px;
      border: 1px solid var(--cg-border);
      background: var(--cg-bg);
      color: var(--cg-text);
      font-family: var(--cg-font);
      font-size: 13.5px;
      resize: none;
      outline: none;
      line-height: 1.4;
      box-sizing: border-box;
    }
    .cg-chat-textarea:focus {
      border-color: var(--cg-accent);
    }

    @keyframes cgSpin {
      to { transform: rotate(360deg); }
    }
    .cg-spinner {
      width: 15px;
      height: 15px;
      border: 2px solid var(--cg-accent);
      border-top-color: transparent;
      border-radius: 50%;
      animation: cgSpin 0.75s linear infinite;
    }
  `;
}
