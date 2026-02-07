// DEPRECATED: Этот модуль заменён на resume-cache.js
// Оставлен для обратной совместимости

import { loadKeywords as loadKeywordsFromCache } from "./resume-cache.js";

// Загрузка ключевых слов (с кэшированием)
export async function loadKeywords(forceRegenerate = false) {
  return await loadKeywordsFromCache(forceRegenerate);
}

// Экранирование специальных символов regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Проверка, содержит ли текст стоп-слова
export function containsStopWords(text, stopWords) {
  const lowerText = text.toLowerCase();
  return stopWords.some(word => {
    const escapedWord = escapeRegExp(word.toLowerCase());
    const pattern = new RegExp(`\\b${escapedWord}\\b`, "i");
    return pattern.test(lowerText);
  });
}

// Фильтрация вакансий по стоп-словам
export function filterByStopWords(vacancies, stopWords) {
  return vacancies.filter(vacancy => {
    // Проверяем title и описание
    const title = vacancy.title || "";
    const description = vacancy.description || "";

    // Если найдено стоп-слово - отбрасываем вакансию
    const hasStopWord = containsStopWords(title, stopWords) ||
                        containsStopWords(description, stopWords);

    if (hasStopWord) {
      console.log(`🚫 Отфильтрована по стоп-словам: ${vacancy.title} (${vacancy.id})`);
    }

    return !hasStopWord;
  });
}
