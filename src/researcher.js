import axios from "axios";
import * as cheerio from "cheerio";
import { getCachedCompanyResearch, cacheCompanyResearch } from "./storage.js";
import { delay } from "./utils.js";
import { groq, MODEL, TEMPERATURE } from "./groq-client.js";
import stats from "./stats.js";

// Функция 1: Поиск через DuckDuckGo HTML-версию
export async function searchDuckDuckGo(query) {
  try {
    stats.trackDuckDuckGoRequest();

    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive"
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Парсинг результатов поиска
    $(".result").each((_, element) => {
      const titleElement = $(element).find(".result__a");
      const snippetElement = $(element).find(".result__snippet");
      const urlElement = $(element).find(".result__url");

      const title = titleElement.text().trim();
      const snippet = snippetElement.text().trim();
      let resultUrl = urlElement.attr("href");

      // DuckDuckGo использует редирект, извлекаем реальный URL
      if (resultUrl && resultUrl.startsWith("//duckduckgo.com/l/?")) {
        const urlParams = new URLSearchParams(resultUrl.split("?")[1]);
        resultUrl = urlParams.get("uddg");
      }

      if (title && snippet && resultUrl) {
        results.push({ title, snippet, url: resultUrl });
      }
    });

    // Ограничиваем до 10 результатов
    return results.slice(0, 10);
  } catch (error) {
    stats.trackError("ddg", error, { query });
    console.error(`⚠️ Ошибка поиска DuckDuckGo: ${error.message}`);
    return [];
  }
}


// Функция 2: Сбор информации о компании
export async function researchCompany(companyName) {
  // Формируем список поисковых запросов
  const queries = [
    `"${companyName}" отзывы сотрудников`,
    `"${companyName}" отзывы работа`,
    `"${companyName}" glassdoor`,
    `"${companyName}" новости`,
    `"${companyName}" зарплата`,
    `"${companyName}" скандал проблемы`
  ];

  const allResults = [];
  const seenUrls = new Set();

  console.log(`🔍 Исследую компанию "${companyName}"...`);

  // Выполняем поиск по каждому запросу с задержкой
  for (const query of queries) {
    console.log(`   Поиск: "${query}"`);
    const results = await searchDuckDuckGo(query);

    // Дедупликация по URL
    for (const result of results) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        allResults.push(result);
      }
    }

    // Задержка между запросами 1-2 секунды
    await delay(1000, 2000);
  }

  // Ограничиваем общее количество результатов
  const limitedResults = allResults.slice(0, 20);

  console.log(`   ✅ Найдено ${limitedResults.length} уникальных источников`);

  return {
    companyName,
    searchResults: limitedResults,
    searchQueries: queries,
    searchedAt: new Date().toISOString()
  };
}

// Функция 3: Анализ информации о компании через LLM
export async function analyzeCompanyInfo(companyName, searchResults) {
  // Формируем текстовое представление результатов поиска
  const resultsText = searchResults.map((r, i) => `
${i + 1}. ${r.title}
   URL: ${r.url}
   Описание: ${r.snippet}
`).join('\n');

  const prompt = `Ты аналитик, исследующий компании для соискателей работы.

Проанализируй информацию о компании "${companyName}" на основе результатов поиска.

РЕЗУЛЬТАТЫ ПОИСКА:
${resultsText}

ЗАДАЧА:
Проанализируй информацию и извлеки:

1. ОБЩАЯ ИНФОРМАЦИЯ
   - Чем занимается компания
   - Размер (если известно)
   - Сколько лет на рынке (если известно)

2. ПОЗИТИВНЫЕ СИГНАЛЫ (хорошо для соискателя)
   - Хорошие отзывы
   - Стабильность
   - Узнаваемость бренда
   - Интересные продукты
   - и т.д.

3. КРАСНЫЕ ФЛАГИ (тревожные сигналы)
   - Негативные отзывы о зарплате/условиях
   - Задержки выплат
   - Высокая текучка
   - Скандалы
   - Судебные иски
   - Признаки нестабильности
   - и т.д.

4. НЕИЗВЕСТНО / ТРЕБУЕТ ПРОВЕРКИ
   - Что не удалось определить
   - Что уточнить на собеседовании

5. ОЦЕНКА НАДЁЖНОСТИ
   - Шкала: 1-10 (1 = много красных флагов, 10 = отличная репутация)
   - Краткий вывод одним предложением

ВАЖНО: Весь ответ должен быть на РУССКОМ языке!

Верни ответ СТРОГО в формате JSON:
{
  "overview": {
    "description": "Краткое описание компании",
    "size": "Размер или null",
    "age": "Сколько лет на рынке или null",
    "industry": "Отрасль"
  },
  "positives": [
    "Позитивный сигнал 1",
    "Позитивный сигнал 2"
  ],
  "redFlags": [
    "Красный флаг 1 (если есть)"
  ],
  "unknown": [
    "Что не удалось определить"
  ],
  "reliabilityScore": 8,
  "reliabilitySummary": "Краткий вывод одним предложением",
  "sources": ["url1", "url2"]
}

Если информации недостаточно для анализа, укажи это в полях и установи reliabilityScore: null.
Отвечай ТОЛЬКО JSON, без markdown-обёртки и пояснений.`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: TEMPERATURE,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    const analysis = JSON.parse(content);

    return analysis;
  } catch (error) {
    console.error(`⚠️ Ошибка анализа через LLM: ${error.message}`);

    // Возвращаем заглушку при ошибке
    return {
      status: "llm_error",
      error: error.message,
      overview: {
        description: "Не удалось проанализировать",
        size: null,
        age: null,
        industry: "Неизвестно"
      },
      positives: [],
      redFlags: ["Ошибка при анализе"],
      unknown: ["Все данные"],
      reliabilityScore: null,
      reliabilitySummary: "Анализ не выполнен из-за ошибки",
      sources: []
    };
  }
}

// Функция 4: Главная функция модуля
export async function getCompanyResearch(companyName) {
  // Проверяем кэш
  const cached = await getCachedCompanyResearch(companyName);
  if (cached) {
    console.log(`📦 Использую кэш для компании "${companyName}"`);
    return cached;
  }

  console.log(`\n🏢 Начинаю исследование компании "${companyName}"`);

  // 1. Собираем информацию
  const searchData = await researchCompany(companyName);

  // 2. Если результатов мало — возвращаем заглушку
  if (searchData.searchResults.length < 3) {
    console.log(`⚠️  Недостаточно информации о компании "${companyName}"`);
    const result = {
      companyName,
      status: "insufficient_data",
      message: "Недостаточно информации о компании в открытых источниках",
      searchResults: searchData.searchResults,
      searchedAt: searchData.searchedAt
    };

    // Кэшируем даже неудачный результат
    await cacheCompanyResearch(companyName, result);
    return result;
  }

  // 3. Анализируем через LLM
  console.log(`🤖 Анализирую информацию через LLM...`);
  const analysis = await analyzeCompanyInfo(companyName, searchData.searchResults);

  console.log(`✅ Исследование завершено. Оценка надёжности: ${analysis.reliabilityScore}/10`);

  const result = {
    companyName,
    status: "success",
    analysis,
    searchResults: searchData.searchResults,
    searchedAt: searchData.searchedAt
  };

  // Сохраняем в кэш
  await cacheCompanyResearch(companyName, result);

  return result;
}
