/**
 * Модуль для отслеживания статистики запросов и ошибок
 */

class Stats {
  constructor() {
    // Счётчики запросов
    this.requests = {
      groq: { count: 0, tokens: { input: 0, output: 0 } },
      hh: { count: 0 },
      duckduckgo: { count: 0 }
    };

    // Категоризация ошибок
    this.errors = {
      // Groq API ошибки
      "groq:rate_limit": [],
      "groq:timeout": [],
      "groq:other": [],

      // hh.ru ошибки
      "hh:captcha": [],
      "hh:timeout": [],
      "hh:blocked": [],
      "hh:other": [],

      // DuckDuckGo ошибки
      "ddg:timeout": [],
      "ddg:blocked": [],
      "ddg:other": [],

      // Общие ошибки
      "parse:json": [],
      "network:other": []
    };
  }

  /**
   * Регистрирует запрос к Groq API
   * @param {object} usage - Объект usage из ответа API (prompt_tokens, completion_tokens)
   */
  trackGroqRequest(usage = null) {
    this.requests.groq.count++;
    if (usage) {
      this.requests.groq.tokens.input += usage.prompt_tokens || 0;
      this.requests.groq.tokens.output += usage.completion_tokens || 0;
    }
  }

  /**
   * Регистрирует запрос к hh.ru
   */
  trackHHRequest() {
    this.requests.hh.count++;
  }

  /**
   * Регистрирует запрос к DuckDuckGo
   */
  trackDuckDuckGoRequest() {
    this.requests.duckduckgo.count++;
  }

  /**
   * Регистрирует ошибку с категоризацией
   * @param {string} source - Источник: 'groq', 'hh', 'ddg', 'parse', 'network'
   * @param {Error|string} error - Объект ошибки или сообщение
   * @param {object} context - Дополнительный контекст (url, id вакансии и т.д.)
   */
  trackError(source, error, context = {}) {
    const message = error.message || String(error);
    const errorData = {
      message,
      timestamp: new Date().toISOString(),
      ...context
    };

    // Категоризация по источнику и типу
    const category = this._categorizeError(source, message, error);

    if (this.errors[category]) {
      this.errors[category].push(errorData);
    } else {
      // Fallback категория
      const fallbackCategory = `${source}:other`;
      if (this.errors[fallbackCategory]) {
        this.errors[fallbackCategory].push(errorData);
      }
    }
  }

  /**
   * Категоризирует ошибку по источнику и сообщению
   */
  _categorizeError(source, message, error) {
    const lowerMessage = message.toLowerCase();

    switch (source) {
      case "groq":
        if (error.status === 429 || lowerMessage.includes("rate limit") || lowerMessage.includes("превышен лимит")) {
          return "groq:rate_limit";
        }
        if (lowerMessage.includes("timeout") || lowerMessage.includes("таймаут")) {
          return "groq:timeout";
        }
        return "groq:other";

      case "hh":
        if (lowerMessage.includes("captcha") || lowerMessage.includes("капча") || lowerMessage.includes("робот")) {
          return "hh:captcha";
        }
        if (lowerMessage.includes("timeout") || lowerMessage.includes("таймаут") || lowerMessage.includes("econnaborted")) {
          return "hh:timeout";
        }
        if (lowerMessage.includes("блокировка") || lowerMessage.includes("403") || lowerMessage.includes("blocked")) {
          return "hh:blocked";
        }
        return "hh:other";

      case "ddg":
        if (lowerMessage.includes("timeout") || lowerMessage.includes("10000ms") || lowerMessage.includes("econnaborted")) {
          return "ddg:timeout";
        }
        if (lowerMessage.includes("blocked") || lowerMessage.includes("403")) {
          return "ddg:blocked";
        }
        return "ddg:other";

      case "parse":
        if (lowerMessage.includes("json") || lowerMessage.includes("parse") || lowerMessage.includes("unexpected token")) {
          return "parse:json";
        }
        return "network:other";

      default:
        return "network:other";
    }
  }

  /**
   * Возвращает общее количество ошибок
   */
  getTotalErrors() {
    return Object.values(this.errors).reduce((sum, arr) => sum + arr.length, 0);
  }

  /**
   * Возвращает статистику ошибок по категориям
   */
  getErrorStats() {
    const stats = {};
    for (const [category, errors] of Object.entries(this.errors)) {
      if (errors.length > 0) {
        stats[category] = errors.length;
      }
    }
    return stats;
  }

  /**
   * Возвращает общую статистику
   */
  getSummary() {
    return {
      requests: {
        groq: {
          count: this.requests.groq.count,
          tokens: {
            input: this.requests.groq.tokens.input,
            output: this.requests.groq.tokens.output,
            total: this.requests.groq.tokens.input + this.requests.groq.tokens.output
          }
        },
        hh: this.requests.hh.count,
        duckduckgo: this.requests.duckduckgo.count,
        total: this.requests.groq.count + this.requests.hh.count + this.requests.duckduckgo.count
      },
      errors: {
        total: this.getTotalErrors(),
        byCategory: this.getErrorStats()
      }
    };
  }

  /**
   * Выводит статистику в консоль
   */
  printSummary() {
    const summary = this.getSummary();

    console.log("\n" + "=".repeat(60));
    console.log("📊 СТАТИСТИКА ЗАПРОСОВ И ОШИБОК");
    console.log("=".repeat(60));

    // Запросы
    console.log("\n🌐 ЗАПРОСЫ:");
    console.log(`   Groq API: ${summary.requests.groq.count} запросов`);
    if (summary.requests.groq.tokens.total > 0) {
      console.log(`      └─ Токены: ${summary.requests.groq.tokens.input.toLocaleString()} вход + ${summary.requests.groq.tokens.output.toLocaleString()} выход = ${summary.requests.groq.tokens.total.toLocaleString()} всего`);
    }
    console.log(`   hh.ru: ${summary.requests.hh} запросов`);
    console.log(`   DuckDuckGo: ${summary.requests.duckduckgo} запросов`);
    console.log(`   ─────────────────────────`);
    console.log(`   ВСЕГО: ${summary.requests.total} запросов`);

    // Ошибки
    if (summary.errors.total > 0) {
      console.log("\n❌ ОШИБКИ:");
      console.log(`   Всего: ${summary.errors.total}`);
      console.log();

      // Группируем по источникам
      const errorsBySource = {
        "Groq API": ["groq:rate_limit", "groq:timeout", "groq:other"],
        "hh.ru": ["hh:captcha", "hh:timeout", "hh:blocked", "hh:other"],
        "DuckDuckGo": ["ddg:timeout", "ddg:blocked", "ddg:other"],
        "Другие": ["parse:json", "network:other"]
      };

      for (const [sourceName, categories] of Object.entries(errorsBySource)) {
        const sourceErrors = categories
          .filter(cat => summary.errors.byCategory[cat])
          .map(cat => {
            const label = this._getCategoryLabel(cat);
            return `${label}: ${summary.errors.byCategory[cat]}`;
          });

        if (sourceErrors.length > 0) {
          console.log(`   ${sourceName}:`);
          sourceErrors.forEach(err => console.log(`      • ${err}`));
        }
      }
    } else {
      console.log("\n✅ ОШИБОК НЕТ");
    }

    console.log("=".repeat(60) + "\n");
  }

  /**
   * Возвращает человекочитаемую метку для категории ошибки
   */
  _getCategoryLabel(category) {
    const labels = {
      "groq:rate_limit": "Rate Limit (превышен лимит)",
      "groq:timeout": "Timeout",
      "groq:other": "Другие",
      "hh:captcha": "Captcha/блокировка",
      "hh:timeout": "Timeout",
      "hh:blocked": "Заблокирован",
      "hh:other": "Другие",
      "ddg:timeout": "Timeout",
      "ddg:blocked": "Заблокирован",
      "ddg:other": "Другие",
      "parse:json": "Ошибка парсинга JSON",
      "network:other": "Сетевые"
    };
    return labels[category] || category;
  }

  /**
   * Сбрасывает статистику
   */
  reset() {
    this.requests = {
      groq: { count: 0, tokens: { input: 0, output: 0 } },
      hh: { count: 0 },
      duckduckgo: { count: 0 }
    };

    for (const key of Object.keys(this.errors)) {
      this.errors[key] = [];
    }
  }
}

// Глобальный экземпляр
const stats = new Stats();

export default stats;
