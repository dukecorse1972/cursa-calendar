import { ThemeManager } from './theme/ThemeManager';
import { GoogleCalendarAdapter } from './adapter/GoogleCalendarAdapter';
import { AcademicPanel } from './ui/panel';
import { AppState } from './state';
import { CreatorModal } from './ui/creatorModal';
import { AcademicDetailModal } from './ui/detailModal';
import { OnboardingModal } from './ui/onboardingModal';
import { GradesModule } from './ui/grades/gradesModule';

let isInitialized = false;

export function initCustomLayer(): void {
  // Never inject or alter the accounts.google.com login pages (Rule 5 & 42)
  if (!window.location.hostname.includes('calendar.google.com')) {
    return;
  }

  if (isInitialized) {
    AcademicPanel.getInstance().mountInTopHeader();
    GradesModule.getInstance().transformCalendarLogoTextIntoDropdown();
    return;
  }

  const runInit = () => {
    try {
      // 1. Initialize Theme Engine
      const themeManager = ThemeManager.getInstance();
      themeManager.init();
      themeManager.onThemeChange((mode) => {
        AppState.getInstance().setTheme(mode);
      });

      // 2. Initialize Calendar Adapter
      const adapter = GoogleCalendarAdapter.getInstance();
      adapter.init();

      // 3. Mount Custom Academic Panel
      const panel = AcademicPanel.getInstance();
      panel.init();

      // 4. Initialize Grades & Simulator Module
      const gradesModule = GradesModule.getInstance();
      gradesModule.init();

      isInitialized = true;
      console.log('[GoogleCalendarDesktop] Custom Academic Layer initialized successfully.');
    } catch (err) {
      console.error('[GoogleCalendarDesktop] Initialization error:', err);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit, { once: true });
  } else {
    runInit();
  }
}

export function destroyCustomLayer(): void {
  if (!isInitialized) return;

  ThemeManager.getInstance().destroy();
  GoogleCalendarAdapter.getInstance().destroy();
  AcademicPanel.getInstance().destroy();
  CreatorModal.getInstance().destroy();
  AcademicDetailModal.getInstance().destroy();
  OnboardingModal.getInstance().close();
  GradesModule.getInstance().showCalendarView();
  AppState.getInstance().destroy();
  isInitialized = false;
}
