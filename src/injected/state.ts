import { AppTab, ThemeMode } from '../shared/types';
import { CALENDAR_GROUPS } from '../shared/constants';
import { getIsolatedItem, setIsolatedItem } from './utils/storage';

export interface AppStateData {
  activeTab: AppTab;
  selectedCalendars: Record<string, boolean>;
  calendarGroups: typeof CALENDAR_GROUPS;
  theme: ThemeMode;
  isSubmitting: boolean;
}

export type StateListener = (state: Readonly<AppStateData>) => void;

export class AppState {
  private static instance: AppState | null = null;
  private state: AppStateData;
  private listeners: Set<StateListener> = new Set();

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState();
    }
    return AppState.instance;
  }

  private constructor() {
    let initialTab: AppTab = 'CLASES';
    try {
      const stored = (getIsolatedItem('gcal_active_tab') ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('gcal_active_tab') : null)) as AppTab | null;
      if (stored === 'CLASES' || stored === 'ENTREGAS_EXAMENES' || stored === 'TODO') {
        initialTab = stored;
      }
    } catch (_) {}

    // Initial default state
    const initialSelected: Record<string, boolean> = {};
    CALENDAR_GROUPS.CLASES.forEach((name) => (initialSelected[name] = true));
    CALENDAR_GROUPS.ACADEMICOS.forEach((name) => (initialSelected[name] = true));
    CALENDAR_GROUPS.OTROS.forEach((name) => (initialSelected[name] = true));

    this.state = {
      activeTab: initialTab,
      selectedCalendars: initialSelected,
      calendarGroups: CALENDAR_GROUPS,
      theme: 'LIGHT',
      isSubmitting: false
    };
  }

  public getState(): Readonly<AppStateData> {
    return this.state;
  }

  public setActiveTab(tab: AppTab): void {
    try {
      setIsolatedItem('gcal_active_tab', tab);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('gcal_active_tab', tab);
      }
    } catch (_) {}
    if (this.state.activeTab === tab) return;
    this.state = { ...this.state, activeTab: tab };
    this.notify();
  }

  public setCalendarVisibility(name: string, visible: boolean): void {
    if (this.state.selectedCalendars[name] === visible) return;
    this.state = {
      ...this.state,
      selectedCalendars: {
        ...this.state.selectedCalendars,
        [name]: visible
      }
    };
    this.notify();
  }

  public setSubmitting(isSubmitting: boolean): void {
    if (this.state.isSubmitting === isSubmitting) return;
    this.state = { ...this.state, isSubmitting };
    this.notify();
  }

  public setTheme(theme: ThemeMode): void {
    if (this.state.theme === theme) return;
    this.state = { ...this.state, theme };
    this.notify();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (err) {
        console.error('[AppState] Error notifying listener:', err);
      }
    });
  }

  public destroy(): void {
    this.listeners.clear();
    AppState.instance = null;
  }
}
