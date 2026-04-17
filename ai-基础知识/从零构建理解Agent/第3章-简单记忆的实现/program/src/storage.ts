import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryItem } from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SHORT_PATH = path.join(DATA_DIR, "short_memory.json");
const LONG_PATH = path.join(DATA_DIR, "long_memory.json");

export interface PersistedState {
  shortTerm: MemoryItem[];
  longTerm: MemoryItem[];
}

export function loadState(): PersistedState {
  return {
    shortTerm: readJsonArray(SHORT_PATH),
    longTerm: readJsonArray(LONG_PATH),
  };
}

export function saveState(state: PersistedState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SHORT_PATH, JSON.stringify(state.shortTerm, null, 2), "utf-8");
  fs.writeFileSync(LONG_PATH, JSON.stringify(state.longTerm, null, 2), "utf-8");
}

function readJsonArray(filePath: string): MemoryItem[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MemoryItem[]) : [];
  } catch {
    return [];
  }
}

