import { contextBridge, ipcRenderer } from 'electron';
import { initCustomLayer, destroyCustomLayer } from '../injected/index';
import { AppState } from '../injected/state';
import { OnboardingModal } from '../injected/ui/onboardingModal';
import { GradesSimulatorView } from '../injected/ui/grades/gradesSimulatorView';
import { GradesModule } from '../injected/ui/grades/gradesModule';
import { clearSessionAccountCache } from '../injected/utils/storage';

function isAllowedPreloadOrigin(): boolean {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    return (
      window.location.origin === 'https://calendar.google.com' ||
      window.location.protocol === 'file:' ||
      window.location.protocol === 'about:'
    );
  } catch {
    return false;
  }
}

const desktopApi = {
  createAcademicEventBackground: (payload: any) =>
    ipcRenderer.invoke('create-academic-event-background', payload),
  deleteAcademicEventBackground: (eventId: string) =>
    ipcRenderer.invoke('delete-academic-event-background', eventId),
  moveAcademicEventBackground: (data: { eventId?: string; payload: any }) =>
    ipcRenderer.invoke('move-academic-event-background', data),
  updateEventDescriptionBackground: (data: { eventId?: string; eventTitle?: string; description: string }) =>
    ipcRenderer.invoke('update-event-description-background', data),
  ensureAcademicCalendarsBackground: (calendarNames?: string[]) =>
    ipcRenderer.invoke('ensure-academic-calendars-background', calendarNames),
  takeScreenshot: (filePath: string) =>
    ipcRenderer.invoke('take-debug-screenshot', filePath)
};

if (isAllowedPreloadOrigin()) {
  try {
    contextBridge.exposeInMainWorld('gcalDesktopAPI', desktopApi);
    contextBridge.exposeInMainWorld('cursaMountSimulator', (parent: HTMLElement, subject?: string) => {
      const view = GradesSimulatorView.getInstance();
      if (subject) view.setActiveSubject(subject);
      view.mount(parent);
    });
  } catch (_) {}

  (window as any).gcalDesktopAPI = desktopApi;
  (window as any).cursaMountSimulator = (parent: HTMLElement, subject?: string) => {
    const view = GradesSimulatorView.getInstance();
    if (subject) view.setActiveSubject(subject);
    view.mount(parent);
  };
  (window as any).cursaGradesModule = GradesModule.getInstance();
}

function runIfCalendar(): void {
  try {
    if (window.location.origin === 'https://calendar.google.com') {
      initCustomLayer();
    }
  } catch (err) {
    console.error('[Preload] Error initializing custom layer:', err);
  }
}

// 1. Check immediately at document-start
runIfCalendar();

// 2. Check at DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runIfCalendar, { once: true });
}

// 3. Check at window load
window.addEventListener('load', runIfCalendar, { once: true });

// 4. Listen for main process signal
ipcRenderer.on('init-custom-layer', () => {
  runIfCalendar();
});

// 5. Listen for tab switch signal from system tray
ipcRenderer.on('switch-academic-tab', (_event, tab: any) => {
  try {
    if (tab === 'CLASES' || tab === 'ENTREGAS_EXAMENES' || tab === 'TODO') {
      AppState.getInstance().setActiveTab(tab);
    }
  } catch (err) {
    console.error('[Preload] Error switching tab from tray:', err);
  }
});

// 6. Listen for settings open signal from system tray
ipcRenderer.on('open-academic-settings', () => {
  try {
    OnboardingModal.getInstance().open(true);
  } catch (err) {
    console.error('[Preload] Error opening academic settings from tray:', err);
  }
});

// 7. Listen for Google sign-out signal to clear transient session state
ipcRenderer.on('user-logged-out', () => {
  try {
    clearSessionAccountCache();
    destroyCustomLayer();
  } catch (err) {
    console.error('[Preload] Error resetting session state on logout:', err);
  }
});
