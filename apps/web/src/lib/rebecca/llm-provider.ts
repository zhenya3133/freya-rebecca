// apps/web/src/lib/rebecca/llm-provider.ts
import OpenAI from "openai";

/**
 * LLM Provider - универсальный интерфейс для работы с разными LLM провайдерами
 * 
 * Поддерживаемые провайдеры:
 * 1. OpenAI (по умолчанию) - GPT-4, GPT-4o, GPT-4o-mini
 * 2. OpenRouter - любые модели через OpenRouter API
 * 3. Local - локальные модели через OpenAI-compatible API (LM Studio, Ollama)
 * 
 * Конфигурация через переменные окружения:
 * - REBECCA_PROVIDER: "openai" | "openrouter" | "local"
 * - REBECCA_MODEL: название модели
 * - REBECCA_BASE_URL: базовый URL для local провайдера
 * - OPENAI_API_KEY: API ключ для OpenAI
 * - OPENROUTER_API_KEY: API ключ для OpenRouter
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: string;
}

/**
 * Получить конфигурацию провайдера из переменных окружения
 */
function getProviderConfig() {
  const provider = (process.env.REBECCA_PROVIDER || "openai").toLowerCase();
  const model = process.env.REBECCA_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.REBECCA_BASE_URL;

  let apiKey: string | undefined;
  let effectiveBaseUrl: string | undefined;

  switch (provider) {
    case "openai":
      apiKey = process.env.OPENAI_API_KEY;
      effectiveBaseUrl = "https://api.openai.com/v1";
      break;

    case "openrouter":
      apiKey = process.env.OPENROUTER_API_KEY;
      effectiveBaseUrl = "https://openrouter.ai/api/v1";
      break;

    case "local":
      apiKey = "not-needed"; // Локальные модели часто не требуют API key
      effectiveBaseUrl = baseUrl || "http://localhost:1234/v1";
      break;

    default:
      throw new Error(`Unknown provider: ${provider}. Use 'openai', 'openrouter', or 'local'`);
  }

  if (!apiKey && provider !== "local") {
    throw new Error(`API key not found for provider '${provider}'. Set OPENAI_API_KEY or OPENROUTER_API_KEY`);
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl: effectiveBaseUrl,
  };
}

/**
 * Главный класс для работы с LLM
 */
export class LLMProvider {
  private static client: OpenAI | null = null;
  private static config = getProviderConfig();

  /**
   * Получить инстанс OpenAI клиента (singleton)
   */
  private static getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
      });
    }
    return this.client;
  }

  /**
   * Отправить сообщения и получить ответ от LLM
   */
  static async chat(
    messages: Message[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    const {
      temperature = 0.7,
      maxTokens = 4096,
      stopSequences = [],
      stream = false,
    } = options;

    const client = this.getClient();

    try {
      const response = await client.chat.completions.create({
        model: this.config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature,
        max_tokens: maxTokens,
        stop: stopSequences.length > 0 ? stopSequences : undefined,
        stream: false, // TODO: поддержка streaming в будущем
      });

      const choice = response.choices[0];
      
      return {
        content: choice.message?.content || "",
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        model: response.model,
        finishReason: choice.finish_reason || undefined,
      };
    } catch (error: any) {
      throw new Error(
        `LLM request failed (${this.config.provider}/${this.config.model}): ${error.message}`
      );
    }
  }

  /**
   * Вспомогательный метод: простой запрос с одним сообщением
   */
  static async ask(
    prompt: string,
    systemMessage?: string,
    options?: ChatOptions
  ): Promise<string> {
    const messages: Message[] = [];
    
    if (systemMessage) {
      messages.push({ role: "system", content: systemMessage });
    }
    
    messages.push({ role: "user", content: prompt });

    const response = await this.chat(messages, options);
    return response.content;
  }

  /**
   * Получить информацию о текущем провайдере
   */
  static getConfig() {
    return {
      provider: this.config.provider,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
    };
  }

  /**
   * Проверить, доступен ли LLM провайдер
   */
  static async healthCheck(): Promise<boolean> {
    try {
      await this.ask("Hello!", undefined, { maxTokens: 10 });
      return true;
    } catch (error) {
      console.error("LLM health check failed:", error);
      return false;
    }
  }

  /**
   * Сброс клиента (для тестов или переконфигурации)
   */
  static reset() {
    this.client = null;
    this.config = getProviderConfig();
  }
}

/**
 * Вспомогательные функции для работы с JSON в ответах LLM
 */

/**
 * Извлечь JSON из markdown code block
 */
export function extractJSON<T = any>(text: string): T | null {
  // Ищем JSON в markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // Не JSON внутри блока
    }
  }

  // Ищем просто JSON объект
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Не валидный JSON
    }
  }

  return null;
}

/**
 * Запросить LLM с ожиданием JSON ответа
 */
export async function askForJSON<T = any>(
  prompt: string,
  systemMessage?: string,
  options?: ChatOptions
): Promise<T | null> {
  const fullSystemMessage = systemMessage
    ? `${systemMessage}\n\nIMPORTANT: Respond with valid JSON only. Wrap in markdown code block if needed.`
    : "Respond with valid JSON only. Wrap in markdown code block if needed.";

  const response = await LLMProvider.ask(prompt, fullSystemMessage, {
    ...options,
    temperature: options?.temperature ?? 0.3, // Ниже температура для более детерминированных JSON
  });

  return extractJSON<T>(response);
}
