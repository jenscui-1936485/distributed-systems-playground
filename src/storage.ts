import { useSyncExternalStore } from 'react';
import type { LabConfig, LabId, SavedRun, SavedScenario, StoreData } from './model';

const KEY = 'distributed-systems-playground-v1';
const LAB_IDS: LabId[] = ['queue', 'cache', 'rate-limit', 'resilience', 'consistency'];

function emptyStore(): StoreData {
  return {
    version: 1,
    scenarios: [],
    runs: [],
    progress: { explored: [], challenges: [] },
    persistWarning: false,
  };
}

function isLabId(value: unknown): value is LabId {
  return typeof value === 'string' && LAB_IDS.includes(value as LabId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function filterIds(value: unknown): LabId[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isLabId);
}

function readScenario(value: unknown): SavedScenario | null {
  if (!isRecord(value) || !isLabId(value.labId) || !isRecord(value.config)) return null;
  if (value.config.labId !== value.labId) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    labId: value.labId,
    name: value.name,
    config: value.config as unknown as LabConfig,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  };
}

function readRun(value: unknown): SavedRun | null {
  if (!isRecord(value) || !isLabId(value.labId) || !isRecord(value.config)) return null;
  if (value.config.labId !== value.labId) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    labId: value.labId,
    name: value.name,
    config: value.config as unknown as LabConfig,
    summary: typeof value.summary === 'string' ? value.summary : '',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  };
}

function load(): StoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return emptyStore();
    const progress = isRecord(parsed.progress) ? parsed.progress : {};
    return {
      version: 1,
      scenarios: Array.isArray(parsed.scenarios)
        ? parsed.scenarios.map(readScenario).filter((item): item is SavedScenario => item !== null).slice(0, 24)
        : [],
      runs: Array.isArray(parsed.runs)
        ? parsed.runs.map(readRun).filter((item): item is SavedRun => item !== null).slice(0, 24)
        : [],
      progress: {
        explored: filterIds(progress.explored),
        challenges: filterIds(progress.challenges),
      },
      persistWarning: false,
    };
  } catch {
    return { ...emptyStore(), persistWarning: true };
  }
}

let state = load();
const listeners = new Set<() => void>();

function persist() {
  const data = {
    version: state.version,
    scenarios: state.scenarios,
    runs: state.runs,
    progress: state.progress,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    if (!state.persistWarning) state = { ...state, persistWarning: true };
  }
}

function emit() {
  persist();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function saveScenario(input: { labId: LabId; name: string; config: LabConfig }) {
  const scenario: SavedScenario = {
    id: nextId(),
    labId: input.labId,
    name: input.name.trim() || 'Untitled scenario',
    config: input.config,
    createdAt: Date.now(),
  };
  state = { ...state, scenarios: [scenario, ...state.scenarios].slice(0, 24) };
  emit();
  return scenario.id;
}

export function saveRun(input: { labId: LabId; name: string; config: LabConfig; summary: string }) {
  const run: SavedRun = {
    id: nextId(),
    labId: input.labId,
    name: input.name.trim() || 'Untitled run',
    config: input.config,
    summary: input.summary,
    createdAt: Date.now(),
  };
  const explored = state.progress.explored.includes(input.labId)
    ? state.progress.explored
    : [...state.progress.explored, input.labId];
  state = {
    ...state,
    runs: [run, ...state.runs].slice(0, 24),
    progress: { ...state.progress, explored },
  };
  emit();
  return run.id;
}

export function deleteScenario(id: string) {
  state = { ...state, scenarios: state.scenarios.filter((item) => item.id !== id) };
  emit();
}

export function deleteRun(id: string) {
  state = { ...state, runs: state.runs.filter((item) => item.id !== id) };
  emit();
}

export function markExplored(labId: LabId) {
  if (state.progress.explored.includes(labId)) return;
  state = {
    ...state,
    progress: { ...state.progress, explored: [...state.progress.explored, labId] },
  };
  emit();
}

export function markChallenge(labId: LabId) {
  const explored = state.progress.explored.includes(labId)
    ? state.progress.explored
    : [...state.progress.explored, labId];
  if (state.progress.challenges.includes(labId) && explored === state.progress.explored) return;
  const challenges = state.progress.challenges.includes(labId)
    ? state.progress.challenges
    : [...state.progress.challenges, labId];
  state = { ...state, progress: { explored, challenges } };
  emit();
}
