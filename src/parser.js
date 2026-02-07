import axios from "axios";
import * as cheerio from "cheerio";
import stats from "./stats.js";

// Проверка на реальную блокировку/капчу
function isBlocked(html, pageType) {
  // Признаки реальной блокировки
  const blockIndicators = [
    'HHSecurityChallengeBlock',
    'g-recaptcha',
    'Подтвердите, что вы не робот',
    '/captcha/',
    'CheckboxCaptcha'
  ];

  const hasBlockIndicator = blockIndicators.some(indicator =>
    html.includes(indicator)
  );
  
  if (hasBlockIndicator) {
    return true;
  }
  // Проверяем наличие ожидаемого контента
  if (pageType === 'search') {
    // На странице поиска должны быть вакансии или сообщение "ничего не найдено"
    const hasVacancies = html.includes('vacancy-serp-item') || html.includes('serp-item__title');
    const hasNoResults = html.includes('vacancy-search-empty') || html.includes('Вакансии не найдены');

    return !hasVacancies && !hasNoResults;
  }

  if (pageType === 'vacancy') {
    // На странице вакансии должен быть заголовок
    return !html.includes('data-qa="vacancy-title"');
  }

  return false;
}

// Проверка, является ли ошибка повторяемой (сетевая проблема)
function isRetryableError(error) {
  return (
    error.code === "ECONNRESET" ||
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ENOTFOUND" ||
    error.code === "EAI_AGAIN" ||
    error.message?.includes("socket hang up") ||
    error.message?.includes("network") ||
    error.message?.includes("ECONNREFUSED")
  );
}

// HTTP GET запрос с правильными заголовками
async function fetchPageInternal(url, pageType = 'search') {
  stats.trackHHRequest();

  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    },
    timeout: 15000 // Увеличен с 10 до 15 секунд
  });

  // Проверка HTTP статуса
  if (response.status === 403) {
    const error = new Error("CAPTCHA или блокировка hh.ru (HTTP 403)");
    stats.trackError("hh", error, { url, pageType });
    throw error;
  }

  // Проверка на капчу или блокировку по контенту
  if (isBlocked(response.data, pageType)) {
    const error = new Error("CAPTCHA или блокировка hh.ru — контент не найден");
    stats.trackError("hh", error, { url, pageType });
    throw error;
  }

  return response.data;
}

// HTTP GET запрос с retry-логикой
export async function fetchPage(url, pageType = 'search', maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchPageInternal(url, pageType);
    } catch (error) {
      lastError = error;

      // Если это CAPTCHA или блокировка — не повторяем
      if (error.message?.includes("CAPTCHA") || error.message?.includes("блокировка")) {
        throw error;
      }

      // Если ошибка повторяемая и есть ещё попытки
      if (isRetryableError(error) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`⏳ Сетевая ошибка (${error.code || error.message}), попытка ${attempt}/${maxRetries}, повтор через ${delay / 1000}сек...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Отслеживаем ошибку
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        const timeoutError = new Error("Таймаут при запросе к hh.ru");
        stats.trackError("hh", timeoutError, { url, pageType, attempt });
        throw timeoutError;
      }

      if (error.code === "ECONNRESET" || error.message?.includes("socket hang up")) {
        const resetError = new Error("Соединение разорвано (socket hang up)");
        stats.trackError("hh", resetError, { url, pageType, attempt });
        throw resetError;
      }

      stats.trackError("hh", error, { url, pageType, attempt });
      throw error;
    }
  }

  throw lastError;
}

// Проверка, является ли вакансия рекламной
export function isAdvertisedVacancy(url) {
  // Рекламные вакансии на hh.ru используют редирект через adsrv.hh.ru
  return url.includes("adsrv.hh.ru");
}

// Парсинг страницы поиска для извлечения списка URL вакансий и превью
export function parseSearchPage(html, filterAdvertised = true) {
  const $ = cheerio.load(html);
  const vacancies = [];
  const advertisedUrls = [];

  // Находим все карточки вакансий
  $('[data-qa="vacancy-serp__vacancy"]').each((_, card) => {
    const $card = $(card);

    // Извлекаем ссылку и заголовок
    const $titleLink = $card.find('a[data-qa="serp-item__title"]');
    const href = $titleLink.attr("href");

    if (!href) return;

    // Извлекаем чистый URL до знака вопроса
    const cleanUrl = href.split("?")[0];

    // Проверяем на рекламу
    const isAd = isAdvertisedVacancy(cleanUrl);

    if (isAd) {
      advertisedUrls.push(cleanUrl);
      if (filterAdvertised) {
        return;
      }
    }

    // Пропускаем если это не вакансия
    if (!cleanUrl.includes("/vacancy/") && !(!filterAdvertised && isAd)) {
      return;
    }

    // Извлекаем данные превью
    const title = $titleLink.text().trim();

    // Сниппет (краткое описание/требования)
    const snippet = $card.find('[data-qa="vacancy-serp__vacancy_snippet_requirement"]').text().trim() ||
                    $card.find('[data-qa="vacancy-serp__vacancy_snippet_responsibility"]').text().trim() ||
                    "";

    // Компания
    const company = $card.find('[data-qa="vacancy-serp__vacancy-employer"]').text().trim() ||
                    $card.find('a[data-qa="vacancy-serp__vacancy-employer"]').text().trim() ||
                    "";

    // Зарплата
    const salary = $card.find('[data-qa="vacancy-serp__vacancy-compensation"]').text().trim() || "";

    // ID вакансии
    const id = extractVacancyId(cleanUrl);

    vacancies.push({
      id,
      url: cleanUrl,
      title,
      snippet,
      company,
      salary,
      isAd
    });
  });

  // Fallback: если новый селектор не работает, используем старый метод
  if (vacancies.length === 0) {
    $('a[data-qa="serp-item__title"]').each((_, element) => {
      const href = $(element).attr("href");
      if (href) {
        const cleanUrl = href.split("?")[0];
        const isAd = isAdvertisedVacancy(cleanUrl);

        if (isAd) {
          advertisedUrls.push(cleanUrl);
          if (filterAdvertised) {
            return;
          }
        }

        if (cleanUrl.includes("/vacancy/") || (!filterAdvertised && isAd)) {
          const title = $(element).text().trim();
          const id = extractVacancyId(cleanUrl);

          vacancies.push({
            id,
            url: cleanUrl,
            title,
            snippet: "",
            company: "",
            salary: "",
            isAd
          });
        }
      }
    });
  }

  return {
    vacancies,
    advertisedCount: advertisedUrls.length,
    advertisedUrls
  };
}

// Парсинг страницы вакансии
export function parseVacancyPage(html, url) {
  const $ = cheerio.load(html);

  // Извлечение данных
  const title = $('h1[data-qa="vacancy-title"]').text().trim();
  const company = $('a[data-qa="vacancy-company-name"]').first().text().trim() ||
                  $('span[data-qa="vacancy-company-name"]').first().text().trim();

  // Зарплата
  const salaryElement = $('span[data-qa="vacancy-salary-compensation-type-net"]');
  const salary = salaryElement.length > 0 ? salaryElement.text().trim() : "Не указана";

  // Опыт работы
  const experience = $('span[data-qa="vacancy-experience"]').text().trim();

  // Описание вакансии
  const description = $('div[data-qa="vacancy-description"]').text().trim();

  return {
    id: extractVacancyId(url),
    url,
    title,
    company,
    salary,
    experience,
    description,
    parsedAt: new Date().toISOString()
  };
}

// Извлечение ID вакансии из URL
export function extractVacancyId(url) {
  const match = url.match(/\/vacancy\/(\d+)/);
  return match ? match[1] : null;
}

// Реэкспорт delay из utils для обратной совместимости
export { delay } from "./utils.js";

// Построение URL для поиска вакансий с поддержкой фильтров
export function buildSearchUrl(queryOrFilters, page = 0) {
  let params;

  // Если передан строковый запрос (старое поведение)
  if (typeof queryOrFilters === "string") {
    params = new URLSearchParams({
      text: queryOrFilters,
      page: page.toString(),
      hhtmFrom: "vacancy_search_list"
    });
  } else {
    // Если передан объект с фильтрами (новое поведение)
    params = new URLSearchParams({
      ...queryOrFilters,
      page: page.toString(),
      hhtmFrom: "vacancy_search_list"
    });
  }

  return `https://hh.ru/search/vacancy?${params.toString()}`;
}