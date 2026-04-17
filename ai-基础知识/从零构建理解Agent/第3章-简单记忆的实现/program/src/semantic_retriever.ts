import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryItem } from "./types";

const VECTOR_SIZE = 128;
const ZHIPU_MAX_BATCH = 64;
const ZHIPU_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ZHIPU_DEFAULT_MODEL = "embedding-3";
const FALLBACK_MODEL = `hash-${VECTOR_SIZE}`;

type EmbeddingSource = "zhipu" | "fallback";

interface VectorRecord {
  id: string;
  content: string;
  vector: number[];
  source: EmbeddingSource;
  model: string;
  updatedAt: string;
}

export async function rankBySemantic(
  query: string,
  items: MemoryItem[],
  topK = 5
): Promise<Array<{ item: MemoryItem; score: number }>> {
  const q = query.trim();
  if (!q) return [];
  const validItems = items.filter((it) => it.content.trim().length > 0);
  if (validItems.length === 0) return [];

  const vectorStore = await ensureIndexed(validItems);
  const queryEmbedding = await embedTexts([q]);
  const queryVec = queryEmbedding.vectors[0];
  if (!queryVec) return [];

  const scored = validItems
    .map((item) => {
      const rec = vectorStore.get(item.id);
      if (!rec) return null;
      return {
        item,
        score: cosineSimilarity(queryVec, rec.vector),
      };
    })
    .filter((x): x is { item: MemoryItem; score: number } => !!x)
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(0, topK));
}

export async function indexMemoryItem(item: MemoryItem): Promise<void> {
  const content = item.content.trim();
  if (!content) return;

  const store = loadVectorStoreMap();
  const existing = store.get(item.id);
  if (existing && existing.content === content) return;

  const embedding = await embedTexts([content]);
  const vector = embedding.vectors[0];
  if (!vector) return;

  store.set(item.id, {
    id: item.id,
    content,
    vector,
    source: embedding.source,
    model: embedding.model,
    updatedAt: new Date().toISOString(),
  });

  saveVectorStoreMap(store);
}

async function ensureIndexed(items: MemoryItem[]): Promise<Map<string, VectorRecord>> {
  const store = loadVectorStoreMap();
  const needIndex = items.filter((item) => {
    const rec = store.get(item.id);
    return !rec || rec.content !== item.content.trim();
  });

  if (needIndex.length === 0) return store;

  for (let i = 0; i < needIndex.length; i += ZHIPU_MAX_BATCH) {
    const batch = needIndex.slice(i, i + ZHIPU_MAX_BATCH);
    const embedding = await embedTexts(batch.map((x) => x.content));

    batch.forEach((item, idx) => {
      const vector = embedding.vectors[idx];
      if (!vector) return;
      store.set(item.id, {
        id: item.id,
        content: item.content.trim(),
        vector,
        source: embedding.source,
        model: embedding.model,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  saveVectorStoreMap(store);
  return store;
}

async function embedTexts(
  texts: string[]
): Promise<{ vectors: number[][]; source: EmbeddingSource; model: string }> {
  const cfg = readZhipuConfig();
  if (cfg) {
    try {
      const vectors = await requestZhipuEmbeddings(texts, cfg);
      return { vectors, source: "zhipu", model: cfg.model };
    } catch {
      // fallback to local hash vectors
    }
  }

  return {
    vectors: texts.map((x) => textToVector(x)),
    source: "fallback",
    model: FALLBACK_MODEL,
  };
}

function readZhipuConfig():
  | {
      apiKey: string;
      baseUrl: string;
      model: string;
      dimensions?: number;
    }
  | null {
  const apiKey = process.env.ZHIPU_API_KEY?.trim();
  if (!apiKey || apiKey.includes("replace_with_your")) return null;

  const baseUrl = (process.env.ZHIPU_BASE_URL?.trim() || ZHIPU_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.ZHIPU_EMBED_MODEL?.trim() || ZHIPU_DEFAULT_MODEL;
  const rawDimensions = process.env.ZHIPU_EMBED_DIM?.trim();
  const dimensions = rawDimensions ? Number(rawDimensions) : undefined;

  return {
    apiKey,
    baseUrl,
    model,
    dimensions: dimensions && Number.isFinite(dimensions) && dimensions > 0 ? Math.floor(dimensions) : undefined,
  };
}

async function requestZhipuEmbeddings(
  inputs: string[],
  cfg: { apiKey: string; baseUrl: string; model: string; dimensions?: number }
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const body: {
    model: string;
    input: string[];
    dimensions?: number;
  } = {
    model: cfg.model,
    input: inputs,
  };

  if (cfg.dimensions) {
    body.dimensions = cfg.dimensions;
  }

  const resp = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`zhipu embeddings request failed: ${resp.status}`);
  }

  const json = (await resp.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const data = json.data ?? [];
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((x) => x.embedding ?? []);
}

function loadVectorStoreMap(): Map<string, VectorRecord> {
  const vectorStorePath = getVectorStorePath();
  try {
    if (!fs.existsSync(vectorStorePath)) return new Map();
    const raw = fs.readFileSync(vectorStorePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();

    const map = new Map<string, VectorRecord>();
    parsed.forEach((it) => {
      if (!it || typeof it !== "object") return;
      const rec = it as Partial<VectorRecord>;
      if (!rec.id || !Array.isArray(rec.vector) || typeof rec.content !== "string") return;
      map.set(rec.id, {
        id: rec.id,
        content: rec.content,
        vector: rec.vector.filter((x): x is number => typeof x === "number"),
        source: rec.source === "zhipu" ? "zhipu" : "fallback",
        model: typeof rec.model === "string" ? rec.model : FALLBACK_MODEL,
        updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
      });
    });
    return map;
  } catch {
    return new Map();
  }
}

function saveVectorStoreMap(store: Map<string, VectorRecord>): void {
  const vectorStorePath = getVectorStorePath();
  const dir = path.dirname(vectorStorePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(vectorStorePath, JSON.stringify([...store.values()], null, 2), "utf-8");
}

function getVectorStorePath(): string {
  return path.resolve(process.cwd(), "data", "vector_store.json");
}

function textToVector(text: string): number[] {
  const vec = new Array<number>(VECTOR_SIZE).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const idx = hashToken(token) % VECTOR_SIZE;
    vec[idx] += 1;
  }

  return normalize(vec);
}

function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();

  const spaceTokens = normalized.split(/\s+/).filter(Boolean);
  const cjk2gram = buildCjkBigrams(normalized);
  return [...spaceTokens, ...cjk2gram];
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildCjkBigrams(text: string): string[] {
  const chars = [...text.replace(/\s+/g, "")];
  const hasCjk = chars.some((ch) => /\p{Script=Han}/u.test(ch));
  if (!hasCjk || chars.length < 2) return [];

  const result: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) {
    result.push(chars[i] + chars[i + 1]);
  }
  return result;
}
