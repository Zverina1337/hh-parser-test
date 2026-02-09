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
 * Безопасный парсинг JSON из ответа LLM.
 * Извлекает JSON из ответа, даже если LLM добавила лишний текст до/после.
 * @param {string} content - сырой ответ от LLM
 * @param {string} context - контекст вызова для логирования
 * @returns {object} распарсенный JSON
 */
export function safeParseJSON(content, context = "LLM") {
  // Сначала пробуем парсить как есть
  try {
    return JSON.parse(content);
  } catch (directError) {
    console.warn(`⚠️  [${context}] Прямой JSON.parse не удался: ${directError.message}`);
    console.warn(`⚠️  [${context}] Пробую извлечь JSON из ответа...`);
  }

  // Определяем начальный символ: { или [
  const firstBrace = content.indexOf("{");
  const firstBracket = content.indexOf("[");

  let endChar, startPos;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    endChar = "}";
    startPos = firstBrace;
  } else if (firstBracket !== -1) {
    endChar = "]";
    startPos = firstBracket;
  } else {
    console.error(`❌ [${context}] JSON не найден в ответе. Сырой ответ (первые 500 символов):`);
    console.error(content.substring(0, 500));
    throw new Error(`Невалидный JSON от ${context}: JSON-структура не найдена`);
  }

  // Перебираем все позиции закрывающего символа от последней к первой
  // Это решает проблему, когда LLM добавляет текст с } или ] после JSON
  const substring = content.substring(startPos);
  let searchFrom = substring.length;

  while (searchFrom > 0) {
    const endPos = substring.lastIndexOf(endChar, searchFrom - 1);
    if (endPos <= 0) break;

    const candidate = substring.substring(0, endPos + 1);
    try {
      const result = JSON.parse(candidate);
      console.log(`✅ [${context}] JSON успешно извлечён из ответа`);
      return result;
    } catch {
      // Не подошло — пробуем следующую позицию
      searchFrom = endPos;
    }
  }

  console.error(`❌ [${context}] Не удалось извлечь валидный JSON`);
  console.error(`❌ [${context}] Сырой ответ (первые 500 символов):`);
  console.error(content.substring(0, 500));
  throw new Error(`Невалидный JSON от ${context}: не удалось извлечь валидную JSON-структуру`);
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
