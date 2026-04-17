import { MemoryItem } from "./types";

const VECTOR_SIZE = 128;
const ZHIPU_MAX_BATCH = 64;
const ZHIPU_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ZHIPU_DEFAULT_MODEL = "embedding-3";

export async function rankBySemantic(
  query: string,
  items: MemoryItem[],
  topK = 5
): Promise<Array<{ item: MemoryItem; score: number }>> {
  const q = query.trim();
  if (!q) return [];

  const zhipuResult = await rankByZhipuEmbedding(q, items, topK);
  if (zhipuResult) return zhipuResult;

  return rankByFallback(q, items, topK);
}

function rankByFallback(
  query: string,
  items: MemoryItem[],
  topK = 5
): Array<{ item: MemoryItem; score: number }> {
  const queryVec = textToVector(query);
  const scored = items
    .map((item) => ({
      item,
      score: cosineSimilarity(queryVec, textToVector(item.content)),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(0, topK));
}

async function rankByZhipuEmbedding(
  query: string,
  items: MemoryItem[],
  topK: number
): Promise<Array<{ item: MemoryItem; score: number }> | null> {
  const apiKey = process.env.ZHIPU_API_KEY?.trim();
  if (!apiKey || apiKey.includes("replace_with_your")) return null;

  const validItems = items.filter((it) => it.content.trim().length > 0);
  if (validItems.length === 0) return [];

  try {
    const queryEmbeddings = await requestZhipuEmbeddings([query], apiKey);
    const queryVec = queryEmbeddings[0];
    if (!queryVec) return null;

    const scored: Array<{ item: MemoryItem; score: number }> = [];
    for (let i = 0; i < validItems.length; i += ZHIPU_MAX_BATCH) {
      const batch = validItems.slice(i, i + ZHIPU_MAX_BATCH);
      const batchVecs = await requestZhipuEmbeddings(
        batch.map((x) => x.content),
        apiKey
      );

      batch.forEach((item, idx) => {
        const vec = batchVecs[idx];
        if (!vec) return;
        scored.push({
          item,
          score: cosineSimilarity(queryVec, vec),
        });
      });
    }

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK));
  } catch {
    return null;
  }
}

async function requestZhipuEmbeddings(inputs: string[], apiKey: string): Promise<number[][]> {
  const baseUrl = (process.env.ZHIPU_BASE_URL?.trim() || ZHIPU_DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
  const model = process.env.ZHIPU_EMBED_MODEL?.trim() || ZHIPU_DEFAULT_MODEL;
  const rawDimensions = process.env.ZHIPU_EMBED_DIM?.trim();
  const dimensions = rawDimensions ? Number(rawDimensions) : undefined;

  const body: {
    model: string;
    input: string[];
    dimensions?: number;
  } = {
    model,
    input: inputs,
  };

  if (dimensions && Number.isFinite(dimensions) && dimensions > 0) {
    body.dimensions = Math.floor(dimensions);
  }

  const resp = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
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
