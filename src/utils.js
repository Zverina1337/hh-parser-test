/**
 * Рандомная задержка между запросами
 * @param {number} min - минимальная задержка в мс
 * @param {number} max - максимальная задержка в мс
 * @returns {Promise<void>}
 */
export function delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Нормализует название компании для использования в путях и именах файлов
 * @param {string} companyName - название компании
 * @returns {string} нормализованное название
 */
export function normalizeCompanyName(companyName) {
  return companyName
    .toLowerCase()
    .trim()
    .replace(/[^а-яa-z0-9\s-]/gi, "") // Удаляем спецсимволы
    .replace(/\s+/g, "-") // Пробелы в дефисы
    .replace(/-+/g, "-") // Множественные дефисы в один
    .replace(/^-|-$/g, ""); // Убираем дефисы в начале и конце
}
