import OpenAI from "openai";
import dotenv from "dotenv";
import stats from "./stats.js";
import config from "./config.js";

dotenv.config();

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

export const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
export const TEMPERATURE = parseFloat(process.env.GROQ_TEMPERATURE || "0.7");

// Rate Limiter для отслеживания токенов за минуту
class RateLimiter {
  constructor() {
    this.tokenHistory = []; // [{timestamp, tokens}]
    this.requestHistory = []; // [timestamp]
    this.windowMs = 60000; // 1 минута
  }

  // Получить лимиты для текущей модели
  getLimits(model) {
    const limits = config.llm.rateLimits[model] || config.llm.rateLimits["default"];
    return limits;
  }

  // Очистить устаревшие записи (старше 1 минуты)
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    this.tokenHistory = this.tokenHistory.filter(entry => entry.timestamp > cutoff);
    this.requestHistory = this.requestHistory.filter(ts => ts > cutoff);
  }

  // Получить текущее использование за последнюю минуту
  getCurrentUsage() {
    this.cleanup();

    const tokensUsed = this.tokenHistory.reduce((sum, entry) => sum + entry.tokens, 0);
    const requestsUsed = this.requestHistory.length;

    return { tokensUsed, requestsUsed };
  }

  // Записать использование токенов
  trackUsage(tokens) {
    const now = Date.now();
    this.tokenHistory.push({ timestamp: now, tokens });
    this.requestHistory.push(now);
  }

  // Проверить нужно ли ждать перед следующим запросом
  async waitIfNeeded(model, estimatedTokens = 0) {
    const limits = this.getLimits(model);
    const threshold = config.llm.rateLimitThreshold || 0.8;

    this.cleanup();
    const { tokensUsed, requestsUsed } = this.getCurrentUsage();

    const tokenLimit = limits.tokensPerMinute * threshold;
    const requestLimit = limits.requestsPerMinute * threshold;

    // Проверяем, превышен ли порог
    const tokensAfterRequest = tokensUsed + estimatedTokens;
    const requestsAfterRequest = requestsUsed + 1;

    if (tokensAfterRequest >= tokenLimit || requestsAfterRequest >= requestLimit) {
      // Находим самую старую запись и ждём пока она устареет
      const oldestToken = this.tokenHistory.length > 0 ? this.tokenHistory[0].timestamp : Date.now();
      const oldestRequest = this.requestHistory.length > 0 ? this.requestHistory[0] : Date.now();
      const oldest = Math.min(oldestToken, oldestRequest);

      const waitTime = Math.max(0, (oldest + this.windowMs) - Date.now() + 1000); // +1с буфер

      if (waitTime > 0) {
        const reason = tokensAfterRequest >= tokenLimit ? "tokens" : "requests";
        console.log(`\n⏳ Rate limit (${reason}): ожидание ${Math.ceil(waitTime / 1000)}с до сброса лимита...`);
        console.log(`   Использовано: ${tokensUsed}/${Math.floor(tokenLimit)} токенов, ${requestsUsed}/${Math.floor(requestLimit)} запросов`);

        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.cleanup(); // Очищаем после ожидания
      }
    }
  }

  // Вывод текущей статистики
  printStatus(model) {
    const limits = this.getLimits(model);
    const { tokensUsed, requestsUsed } = this.getCurrentUsage();

    console.log(`📊 Rate limit: ${tokensUsed}/${limits.tokensPerMinute} токенов, ${requestsUsed}/${limits.requestsPerMinute} запросов за минуту`);
  }
}

// Глобальный rate limiter
const rateLimiter = new RateLimiter();

// Обёртка над Groq клиентом для отслеживания статистики и rate limiting
export const groq = {
  chat: {
    completions: {
      create: async (params) => {
        const model = params.model || MODEL;

        // Ждём если нужно (с оценкой ~2000 токенов на запрос)
        await rateLimiter.waitIfNeeded(model, 2000);

        try {
          const response = await groqClient.chat.completions.create(params);

          // Отслеживаем использование токенов
          const totalTokens = response.usage?.total_tokens || 0;
          rateLimiter.trackUsage(totalTokens);

          // Отслеживаем успешный запрос и токены для статистики
          stats.trackGroqRequest(response.usage);

          return response;
        } catch (error) {
          // При ошибке 429 ждём и пробуем снова
          if (error.status === 429) {
            console.log(`\n⚠️  Rate limit exceeded. Ожидание 60 секунд...`);
            await new Promise(resolve => setTimeout(resolve, 60000));

            // Очищаем историю и пробуем снова
            rateLimiter.cleanup();
            return groqClient.chat.completions.create(params);
          }

          // Отслеживаем ошибку
          stats.trackError("groq", error, { model: params.model });
          throw error;
        }
      }
    }
  },

  // Экспортируем rate limiter для внешнего доступа
  rateLimiter
};
