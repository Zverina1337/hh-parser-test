import { loadFilters as loadFiltersFromCache } from "./resume-cache.js";

/**
 * Построение параметров фильтрации для hh.ru на основе извлечённых данных
 * @param {Object} extractedData - Данные из extractResumeKeywords
 * @param {string} userQuery - Дополнительный поисковый запрос от пользователя (опционально)
 * @returns {Object} Объект с параметрами для URL
 */
export function buildHHFilters(extractedData, userQuery = "") {
  const filters = {};

  // Текстовый поисковый запрос
  const searchTerms = [...extractedData.keywords];
  if (userQuery) {
    searchTerms.unshift(userQuery);
  }
  if (searchTerms.length > 0) {
    filters.text = searchTerms.join(" OR ");
  }

  // Опыт работы
  if (extractedData.experience) {
    filters.experience = extractedData.experience;
  }

  // График работы (можно несколько)
  if (extractedData.schedule && extractedData.schedule.length > 0) {
    filters.schedule = extractedData.schedule.join(",");
  }

  // Тип занятости (можно несколько)
  if (extractedData.employment && extractedData.employment.length > 0) {
    filters.employment = extractedData.employment.join(",");
  }

  // Зарплата
  if (extractedData.minSalary) {
    filters.salary = extractedData.minSalary;
    filters.currency = extractedData.currency || "RUR";
    filters.only_with_salary = "true"; // Показывать только вакансии с указанной зарплатой
  }

  // Область поиска (по умолчанию ищем в названии и описании)
  filters.search_field = "name,description";

  // Количество вакансий на странице (максимум 100)
  filters.per_page = 100;

  return filters;
}

/**
 * Основная функция для получения фильтров (с кэшированием)
 * @param {string} userQuery - Дополнительный поисковый запрос от пользователя
 * @param {boolean} forceRegenerate - Принудительная регенерация фильтров
 * @returns {Promise<Object>} Объект с параметрами фильтрации
 */
export async function getSearchFilters(userQuery = "", forceRegenerate = false) {
  // Загружаем фильтры из единого кэша резюме
  const extractedData = await loadFiltersFromCache(forceRegenerate);

  console.log("Используются фильтры из resume-cache.json");

  // Строим фильтры для hh.ru
  const filters = buildHHFilters(extractedData, userQuery);

  return filters;
}

/**
 * Построение URL для поиска вакансий на hh.ru
 * @param {Object} filters - Объект с параметрами фильтрации
 * @param {number} page - Номер страницы (начиная с 0)
 * @returns {string} Готовый URL для запроса
 */
export function buildSearchURL(filters, page = 0) {
  const params = new URLSearchParams({
    ...filters,
    page: page.toString()
  });

  return `https://hh.ru/search/vacancy?${params.toString()}`;
}
