import { LayeredMemoryManager, MemoryOptions } from "../memory_manager";
import { MemoryItem, Role } from "../types";
import { PersistedState, loadState, saveState } from "../storage";

export interface MemoryStorage {
  load(): PersistedState;
  save(state: PersistedState): void;
}

export class FileMemoryStorage implements MemoryStorage {
  load(): PersistedState {
    return loadState();
  }

  save(state: PersistedState): void {
    saveState(state);
  }
}

export class InMemoryStorage implements MemoryStorage {
  private state: PersistedState = { shortTerm: [], longTerm: [] };

  load(): PersistedState {
    return {
      shortTerm: [...this.state.shortTerm],
      longTerm: [...this.state.longTerm],
    };
  }

  save(state: PersistedState): void {
    this.state = {
      shortTerm: [...state.shortTerm],
      longTerm: [...state.longTerm],
    };
  }
}

export class MemoryModule {
  private readonly manager: LayeredMemoryManager;

  constructor(
    private readonly storage: MemoryStorage = new FileMemoryStorage(),
    options: MemoryOptions = {}
  ) {
    this.manager = new LayeredMemoryManager(options);
  }

  init(): void {
    const state = this.storage.load();
    this.manager.load(state.shortTerm, state.longTerm);
  }

  snapshot(): { shortTerm: MemoryItem[]; longTerm: MemoryItem[] } {
    return this.manager.dump();
  }

  counts(): { short: number; long: number } {
    const dump = this.snapshot();
    return {
      short: dump.shortTerm.length,
      long: dump.longTerm.length,
    };
  }

  async record(role: Role, content: string, importance = 3): Promise<void> {
    await this.manager.add(role, content, importance);
    this.flush();
  }

  recentShort(n = 8): MemoryItem[] {
    return this.manager.recentShort(n);
  }

  recentLong(n = 8): MemoryItem[] {
    return this.manager.recentLong(n);
  }

  topImportant(n = 5): MemoryItem[] {
    return this.manager.topImportant(n);
  }

  search(keyword: string): MemoryItem[] {
    return this.manager.search(keyword);
  }

  retrieveContext(keyword: string, recentN = 6, importantN = 4): MemoryItem[] {
    return this.manager.retrieveContext(keyword, recentN, importantN);
  }

  async retrieveSemanticContext(query: string, topK = 5): Promise<MemoryItem[]> {
    return this.manager.retrieveSemanticContext(query, topK);
  }

  flush(): void {
    const dump = this.manager.dump();
    this.storage.save({
      shortTerm: dump.shortTerm,
      longTerm: dump.longTerm,
    });
  }
}

