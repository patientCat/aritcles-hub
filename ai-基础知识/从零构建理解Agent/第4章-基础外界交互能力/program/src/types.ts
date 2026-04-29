export type Role = "user" | "assistant" | "system";

export type MemoryTier = "short" | "long" | "summary";

export interface MemoryItem {
  id: string;
  role: Role;
  content: string;
  ts: string;
  importance: number;
  tier: MemoryTier;
}

