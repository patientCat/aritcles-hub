import { buildSummary } from "./summarizer";
import { indexMemoryItem, rankBySemantic } from "./semantic_retriever";
import { MemoryItem, Role } from "./types";

export interface MemoryOptions {
  shortMaxItems?: number;
  longMaxItems?: number;
  summaryEvery?: number;
}

export class LayeredMemoryManager {
  private shortTerm: MemoryItem[] = [];
  private longTerm: MemoryItem[] = [];
  private readonly shortMaxItems: number;
  private readonly longMaxItems: number;
  private readonly summaryEvery: number;

  constructor(options: MemoryOptions = {}) {
    this.shortMaxItems = options.shortMaxItems ?? 100;
    this.longMaxItems = options.longMaxItems ?? 500;
    this.summaryEvery = options.summaryEvery ?? 20;
  }

  load(shortItems: MemoryItem[], longItems: MemoryItem[]): void {
    this.shortTerm = [...shortItems].slice(-this.shortMaxItems);
    this.longTerm = [...longItems].slice(-this.longMaxItems);
  }

  dump(): { shortTerm: MemoryItem[]; longTerm: MemoryItem[] } {
    return {
      shortTerm: [...this.shortTerm],
      longTerm: [...this.longTerm],
    };
  }

  async add(role: Role, content: string, importance = 3): Promise<MemoryItem> {
    const item: MemoryItem = {
      id: createId(),
      role,
      content: content.trim(),
      ts: new Date().toISOString(),
      importance: clampImportance(importance),
      tier: "short",
    };

    if (!item.content) throw new Error("content 不能为空");

    this.shortTerm.push(item);
    if (this.shortTerm.length > this.shortMaxItems) this.shortTerm.shift();
    await indexMemoryItem(item);

    if (item.importance >= 4 || role === "system") {
      this.addLongTerm({ ...item, tier: "long" });
    }

    if (this.shortTerm.length > 0 && this.shortTerm.length % this.summaryEvery === 0) {
      await this.makeSummaryFromRecent();
    }

    return item;
  }

  recentShort(n = 8): MemoryItem[] {
    return this.shortTerm.slice(-Math.max(0, n));
  }

  recentLong(n = 8): MemoryItem[] {
    return this.longTerm.slice(-Math.max(0, n));
  }

  topImportant(n = 5): MemoryItem[] {
    return [...this.longTerm]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, Math.max(0, n));
  }

  search(keyword: string): MemoryItem[] {
    const q = keyword.trim().toLowerCase();
    if (!q) return [];
    const all = [...this.longTerm, ...this.shortTerm];
    return all.filter((it) => it.content.toLowerCase().includes(q));
  }

  retrieveContext(keyword: string, recentN = 6, importantN = 4): MemoryItem[] {
    const byKeyword = this.search(keyword);
    const byRecent = this.recentShort(recentN);
    const byImportant = this.topImportant(importantN);
    const map = new Map<string, MemoryItem>();

    [...byKeyword, ...byRecent, ...byImportant].forEach((it) => map.set(it.id, it));

    return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  }

  async retrieveSemanticContext(query: string, topK = 5): Promise<MemoryItem[]> {
    const all = [...this.longTerm, ...this.shortTerm];
    return (await rankBySemantic(query, all, topK)).map((x) => x.item);
  }

  private addLongTerm(item: MemoryItem): void {
    this.longTerm.push(item);
    if (this.longTerm.length > this.longMaxItems) this.longTerm.shift();
  }

  private async makeSummaryFromRecent(): Promise<void> {
    const chunk = this.shortTerm.slice(-this.summaryEvery);
    const content = await buildSummary(chunk);
    if (!content) return;

    const summaryItem: MemoryItem = {
      id: createId(),
      role: "system",
      content: `[summary] ${content}`,
      ts: new Date().toISOString(),
      importance: 5,
      tier: "summary",
    };
    this.addLongTerm(summaryItem);
    await indexMemoryItem(summaryItem);
  }
}

function clampImportance(v: number): number {
  if (Number.isNaN(v)) return 3;
  return Math.min(5, Math.max(1, Math.round(v)));
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
