import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  // Пути к папкам
  paths: {
    data: path.join(__dirname, "..", "data"),
    vacancies: path.join(__dirname, "..", "data", "vacancies"),
    output: path.join(__dirname, "..", "output"),
    resume: path.join(__dirname, "..", "resume.md")
  },

  // Настройки задержек между запросами (в миллисекундах)
  delays: {
    min: 3000,  // Минимальная задержка 3 секунды
    max: 10000  // Максимальная задержка 10 секунд
  },

  // Настройки HTTP-запросов
  http: {
    timeout: 10000,  // Таймаут 10 секунд
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    }
  },

  // Настройки LLM (Groq)
  llm: {
    model: process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
    temperature: parseFloat(process.env.GROQ_TEMPERATURE || "0.7"),
    maxRetries: 3,  // Максимальное количество повторов при ошибке

    // Rate limiting настройки для разных моделей Groq
    rateLimits: {
    // Llama 4 - новейшие модели
    "meta-llama/llama-4-scout-17b-16e-instruct": {
      tokensPerMinute: 30000,  // Лучший TPM!
      tokensPerDay: 500000,
      requestsPerMinute: 30,
      requestsPerDay: 1000
    },
    "meta-llama/llama-4-maverick-17b-128e-instruct": {
      tokensPerMinute: 6000,
      tokensPerDay: 500000,
      requestsPerMinute: 30,
      requestsPerDay: 1000
    },

    // Llama 3.x
    "llama-3.3-70b-versatile": {
      tokensPerMinute: 12000,
      tokensPerDay: 100000,
      requestsPerMinute: 30,
      requestsPerDay: 1000
    },
    "llama-3.1-8b-instant": {
      tokensPerMinute: 6000,
      tokensPerDay: 500000,
      requestsPerMinute: 30,
      requestsPerDay: 14400  // Много запросов в день
    },

    // Qwen - хороший баланс
    "qwen/qwen3-32b": {
      tokensPerMinute: 6000,
      tokensPerDay: 500000,
      requestsPerMinute: 60,  // Больше RPM
      requestsPerDay: 1000
    },

    // Kimi - высокий RPM
    "moonshotai/kimi-k2-instruct": {
      tokensPerMinute: 10000,
      tokensPerDay: 300000,
      requestsPerMinute: 60,
      requestsPerDay: 1000
    },

    // Дефолт
    "default": {
      tokensPerMinute: 6000,
      tokensPerDay: 100000,
      requestsPerMinute: 30,
      requestsPerDay: 1000
    }
    },
    // Порог для автопаузы (% от лимита)
    rateLimitThreshold: 0.8
  },

  // Настройки парсинга
  parsing: {
    defaultLimit: 20,  // Количество вакансий по умолчанию (парсинг идёт пока не наберём это количество)
    filterAdvertised: true  // Фильтровать рекламные вакансии (adsrv.hh.ru)
  },

  // Настройки подписи в сопроводительном письме
  signature: {
    // Какие контакты включать в подпись (по умолчанию только telegram)
    // Доступные: "telegram", "email", "phone", "github", "linkedin", "vk", "whatsapp", "website"
    enabledContacts: ["telegram"],
    // Показывать имя в подписи (false по умолчанию)
    showName: false,
    // Личный сайт/портфолио (если указан и включен в enabledContacts)
    website: process.env.PERSONAL_WEBSITE || ""
  },

  // Настройки предварительной фильтрации по превью
  preFilter: {
    enabled: true,  // Включить/выключить предварительную фильтрацию
    minPreScore: 0.6,  // Минимальный preScore для сохранения вакансии (0-1). Если preScore < minPreScore, вакансия скипается
    logRejected: false  // Логировать отклонённые вакансии (для отладки)
  },

  // Настройки трехэтапной воронки обработки
  funnel: {
    // Этап 2: Быстрый скоринг
    quickScore: {
      minScore: 5,  // Минимальный скор для перехода на этап 3 (1-10)
      descriptionLength: 500  // Количество символов описания для быстрого анализа
    },

    // Этап 3: Глубокий анализ
    deepAnalysis: {
      topN: 10,  // Количество топовых вакансий для глубокого анализа
      parallelRequests: 3  // Количество одновременных запросов к LLM
    }
  }
};

export default config;
