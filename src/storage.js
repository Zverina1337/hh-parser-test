import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeCompanyName } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const VACANCIES_DIR = path.join(DATA_DIR, "vacancies");
const PROCESSED_FILE = path.join(DATA_DIR, "processed.json");
const COMPANY_CACHE_FILE = path.join(DATA_DIR, "company_cache.json");
const COMPANIES_FILE = path.join(DATA_DIR, "companies.json");

// Кэш для processed.json с TTL
const processedCache = {
  data: null,
  timestamp: 0,
  TTL: 5000 // 5 секунд
};

// Кэш для companies.json с TTL
const companiesCache = {
  data: null,
  timestamp: 0,
  TTL: 5000 // 5 секунд
};

// Принудительная очистка кэша processed.json
export function invalidateProcessedCache() {
  processedCache.data = null;
  processedCache.timestamp = 0;
}

// Принудительная очистка кэша companies.json
export function invalidateCompaniesCache() {
  companiesCache.data = null;
  companiesCache.timestamp = 0;
}

// Загрузка реестра обработанных вакансий (с кэшированием)
export async function loadProcessed() {
  const now = Date.now();

  // Проверяем валидность кэша
  if (processedCache.data !== null && (now - processedCache.timestamp) < processedCache.TTL) {
    return processedCache.data;
  }
  try {
    const data = await fs.readFile(PROCESSED_FILE, "utf-8");
    const parsed = JSON.parse(data);

    // Сохраняем в кэш
    processedCache.data = parsed;
    processedCache.timestamp = now;

    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      // Файл не существует, создаём пустой объект
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(PROCESSED_FILE, JSON.stringify({}, null, 2));

      // Кэшируем пустой объект
      processedCache.data = {};
      processedCache.timestamp = now;

      return {};
    }
    throw error;
  }
}

// Проверка: обработана ли вакансия
export async function isProcessed(id) {
  const processed = await loadProcessed();
  return id in processed;
}

// Сохранение вакансии в отдельный JSON-файл
export async function saveVacancy(vacancy) {
  await fs.mkdir(VACANCIES_DIR, { recursive: true });
  const filePath = path.join(VACANCIES_DIR, `${vacancy.id}.json`);

  // Проверяем, существует ли уже вакансия
  let existingVacancy = null;
  try {
    const existingData = await fs.readFile(filePath, "utf-8");
    existingVacancy = JSON.parse(existingData);
  } catch (error) {
    // Файл не существует, это новая вакансия
  }

  // Управление firstSeenAt
  if (existingVacancy && existingVacancy.firstSeenAt) {
    // Если файл существует и имеет firstSeenAt - сохраняем его
    vacancy.firstSeenAt = existingVacancy.firstSeenAt;
  } else if (!vacancy.firstSeenAt) {
    // Если это новая вакансия и firstSeenAt не установлен - устанавливаем текущее время
    vacancy.firstSeenAt = new Date().toISOString();
  }
  // Если vacancy.firstSeenAt уже установлен (например, в тестах) - оставляем как есть

  await fs.writeFile(filePath, JSON.stringify(vacancy, null, 2));
}

// Обновление статуса вакансии в реестре
export async function updateStatus(id, status, metadata = {}) {
  const processed = await loadProcessed();

  if (!processed[id]) {
    processed[id] = {
      status,
      parsedAt: new Date().toISOString(),
      analyzedAt: null,
      quickScoredAt: null,
      quickScore: null,
      reportGeneratedAt: null,
      ...metadata
    };
  } else {
    processed[id].status = status;

    // Обновляем таймстампы в зависимости от статуса
    if (status === "analyzed") {
      processed[id].analyzedAt = new Date().toISOString();
    }
    if (status === "quick_scored" || status === "ready_for_deep") {
      processed[id].quickScoredAt = new Date().toISOString();
    }

    // Сохраняем дополнительные метаданные (например, quickScore)
    Object.assign(processed[id], metadata);
  }

  await fs.writeFile(PROCESSED_FILE, JSON.stringify(processed, null, 2));

  // Инвалидируем кэш после записи
  invalidateProcessedCache();
}

// Получение списка вакансий без анализа (старая функция для обратной совместимости)
export async function getUnanalyzed() {
  const processed = await loadProcessed();
  const unanalyzedIds = Object.entries(processed)
    .filter(([_, data]) => data.status === "parsed")
    .map(([id, _]) => id);

  return unanalyzedIds;
}

// Получение вакансий по статусу
export async function getVacanciesByStatus(status) {
  const processed = await loadProcessed();
  const ids = Object.entries(processed)
    .filter(([_, data]) => data.status === status)
    .map(([id, _]) => id);

  return ids;
}

// Получение всех вакансий определенного статуса с данными (параллельное чтение)
export async function loadVacanciesByStatus(status) {
  const ids = await getVacanciesByStatus(status);

  // Параллельное чтение всех вакансий
  const results = await Promise.allSettled(
    ids.map(id => loadVacancy(id))
  );

  const vacancies = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      vacancies.push(result.value);
    } else {
      console.warn(`⚠️  Не удалось загрузить вакансию ${ids[index]}: ${result.reason.message}`);
    }
  });

  return vacancies;
}

// Загрузка данных вакансии по ID
export async function loadVacancy(id) {
  const filePath = path.join(VACANCIES_DIR, `${id}.json`);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Вакансия с ID ${id} не найдена`);
    }
    throw error;
  }
}

// Получение всех вакансий (параллельное чтение)
export async function getAllVacancies() {
  try {
    const files = await fs.readdir(VACANCIES_DIR);
    const jsonFiles = files.filter(file => file.endsWith(".json"));
    const ids = jsonFiles.map(file => file.replace(".json", ""));

    // Параллельное чтение всех вакансий
    const results = await Promise.allSettled(
      ids.map(id => loadVacancy(id))
    );

    const vacancies = [];
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        vacancies.push(result.value);
      }
    });

    return vacancies;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

// Загрузка JSON файла с дефолтным значением
async function loadJSON(filePath, defaultValue) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultValue;
    }
    throw error;
  }
}

// Сохранение JSON файла
async function saveJSON(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Получение кэшированного исследования компании
export async function getCachedCompanyResearch(companyName) {
  const cache = await loadJSON(COMPANY_CACHE_FILE, {});
  const normalizedName = companyName.toLowerCase().trim();
  return cache[normalizedName] || null;
}

// Сохранение исследования компании в кэш
export async function cacheCompanyResearch(companyName, research) {
  const cache = await loadJSON(COMPANY_CACHE_FILE, {});
  const normalizedName = companyName.toLowerCase().trim();

  cache[normalizedName] = {
    ...research,
    cachedAt: new Date().toISOString()
  };

  await saveJSON(COMPANY_CACHE_FILE, cache);
}

// Загрузка реестра компаний (с кэшированием)
export async function loadCompanies() {
  const now = Date.now();

  // Проверяем валидность кэша
  if (companiesCache.data !== null && (now - companiesCache.timestamp) < companiesCache.TTL) {
    return companiesCache.data;
  }

  const data = await loadJSON(COMPANIES_FILE, {});

  // Сохраняем в кэш
  companiesCache.data = data;
  companiesCache.timestamp = now;

  return data;
}

// Получение информации о компании из реестра
export async function getCompany(companyName) {
  const companies = await loadCompanies();
  const normalizedName = companyName.toLowerCase().trim();
  return companies[normalizedName] || null;
}

// Получение slug компании (для использования в путях)
export async function getCompanySlug(companyName) {
  const company = await getCompany(companyName);
  if (company) {
    return company.slug;
  }

  // Если компании нет в реестре, генерируем новый slug
  return normalizeCompanyName(companyName);
}

// Сохранение информации о компании в реестр
export async function saveCompanyToRegistry(companyName, slug, metadata = {}) {
  const companies = await loadCompanies();
  const normalizedName = companyName.toLowerCase().trim();

  companies[normalizedName] = {
    name: companyName,
    slug,
    createdAt: new Date().toISOString(),
    ...metadata
  };

  await saveJSON(COMPANIES_FILE, companies);

  // Инвалидируем кэш после записи
  invalidateCompaniesCache();
}

// Проверка: есть ли компания в реестре
export async function isCompanyInRegistry(companyName) {
  const company = await getCompany(companyName);
  return company !== null;
}

// Отметка о генерации отчёта для вакансии
export async function markReportGenerated(id) {
  const processed = await loadProcessed();

  if (!processed[id]) {
    throw new Error(`Вакансия с ID ${id} не найдена в реестре`);
  }

  processed[id].reportGeneratedAt = new Date().toISOString();

  await fs.writeFile(PROCESSED_FILE, JSON.stringify(processed, null, 2));

  // Инвалидируем кэш после записи
  invalidateProcessedCache();
}

// Проверка: сгенерирован ли отчёт для вакансии
export async function isReportGenerated(id) {
  const processed = await loadProcessed();
  return processed[id]?.reportGeneratedAt !== null && processed[id]?.reportGeneratedAt !== undefined;
}

// Получение списка проанализированных вакансий без отчётов
export async function getAnalyzedWithoutReports() {
  const processed = await loadProcessed();
  const ids = Object.entries(processed)
    .filter(([_, data]) =>
      data.status === "analyzed" &&
      (data.reportGeneratedAt === null || data.reportGeneratedAt === undefined)
    )
    .map(([id, _]) => id);

  return ids;
}
