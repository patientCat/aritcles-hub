import "dotenv/config";
import { config, getJson } from "serpapi";

type SerpApiResult = {
  answer_box?: { answer?: string };
  knowledge_graph?: { description?: string };
  organic_results?: Array<{ title?: string; snippet?: string; link?: string }>;
};

export async function search(query: string): Promise<string> {
  console.log(`🔍 正在执行 [SerpApi] 搜索: ${query}`);

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return "错误: SERPAPI_API_KEY 未在 .env 文件中配置。";
  }

  try {
    config.api_key = apiKey;

    const results = (await getJson({
      engine: "google",
      q: query,
      gl: "cn",
      hl: "zh-cn",
    })) as SerpApiResult;

    if (results.answer_box?.answer) {
      return results.answer_box.answer;
    }

    if (results.knowledge_graph?.description) {
      return results.knowledge_graph.description;
    }

    if (results.organic_results && results.organic_results.length > 0) {
      return results.organic_results
        .slice(0, 3)
        .map((item, index) => {
          const title = item.title ?? "";
          const snippet = item.snippet ?? "";
          const link = item.link ? `\n🔗 ${item.link}` : "";
          return `[${index + 1}] ${title}\n${snippet}${link}`;
        })
        .join("\n\n");
    }

    return `对不起，没有找到关于 "${query}" 的信息。`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `搜索时发生错误: ${errorMessage}`;
  }
}
