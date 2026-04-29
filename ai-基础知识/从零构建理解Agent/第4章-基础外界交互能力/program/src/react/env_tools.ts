import fs from "node:fs/promises";
import path from "node:path";
import { ToolBox } from "./core";

type EnvToolOptions = {
  allowedReadRoots?: string[];
  httpTimeoutMs?: number;
  httpMaxChars?: number;
  fileMaxChars?: number;
};

const DEFAULT_HTTP_TIMEOUT_MS = 8000;
const DEFAULT_HTTP_MAX_CHARS = 4000;
const DEFAULT_FILE_MAX_CHARS = 6000;

export function registerEnvTools(toolbox: ToolBox, options?: EnvToolOptions): void {
  const readRoots = (options?.allowedReadRoots ?? [process.cwd()]).map((p) => path.resolve(p));
  const httpTimeoutMs = options?.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const httpMaxChars = options?.httpMaxChars ?? DEFAULT_HTTP_MAX_CHARS;
  const fileMaxChars = options?.fileMaxChars ?? DEFAULT_FILE_MAX_CHARS;

  toolbox.registerTool("NowTime", "读取当前时间，输入时区，如 Asia/Shanghai", async (input) => {
    const tz = input.trim() || "Asia/Shanghai";
    try {
      const formatter = new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      return `${tz} ${formatter.format(new Date())}`;
    } catch {
      return `无效时区: ${tz}`;
    }
  });

  toolbox.registerTool("HttpGet", "HTTP GET 获取网页文本，输入完整 URL", async (input) => {
    const raw = input.trim();
    if (!raw) return "URL 不能为空";

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return "URL 格式错误";
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "仅允许 http/https";
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), httpTimeoutMs);
    try {
      const resp = await fetch(url.toString(), {
        method: "GET",
        signal: ctrl.signal,
        headers: {
          "User-Agent": "agent-learning/0.1",
        },
      });
      if (!resp.ok) return `HTTP 错误: ${resp.status}`;
      const text = await resp.text();
      return cutText(text, httpMaxChars);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `请求失败: ${msg}`;
    } finally {
      clearTimeout(timer);
    }
  });

  toolbox.registerTool("ReadFile", "读取本地文件，输入相对路径，仅限白名单目录", async (input) => {
    const relative = input.trim();
    if (!relative) return "路径不能为空";

    const abs = path.resolve(process.cwd(), relative);
    if (!isPathAllowed(abs, readRoots)) {
      return `路径不在允许范围内: ${relative}`;
    }

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return "目标不是文件";
      const content = await fs.readFile(abs, "utf-8");
      return cutText(content, fileMaxChars);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `读取失败: ${msg}`;
    }
  });
}

function isPathAllowed(absPath: string, roots: string[]): boolean {
  return roots.some((root) => absPath === root || absPath.startsWith(root + path.sep));
}

function cutText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n... [truncated ${input.length - maxChars} chars]`;
}

