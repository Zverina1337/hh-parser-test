/**
 * Модуль предварительной фильтрации вакансий по превью
 * Правила генерируются автоматически на основе резюме
 */

// === КОНФИГУРАЦИЯ (загружается из resume-cache.json) ===
let filterRules = null;

/**
 * Загрузка правил фильтрации
 * @param {Object} rules - Правила из resume-cache
 */
export function loadFilterRules(rules) {
  filterRules = rules;
}

/**
 * Получение текущих правил
 */
export function getFilterRules() {
  return filterRules;
}

/**
 * Проверяет превью вакансии и возвращает решение
 * @param {Object} preview - данные превью вакансии
 * @param {string} preview.title - заголовок
 * @param {string} preview.snippet - краткое описание
 * @param {string} [preview.company] - компания
 * @param {string} [preview.salary] - зарплата
 * @returns {Object} { pass: boolean, score: number, reason: string }
 */
export function checkPreview(preview) {
  // Если правила не загружены — пропускаем всё
  if (!filterRules) {
    return {
      pass: true,
      score: 0.5,
      reason: "no rules loaded"
    };
  }

  const title = preview.title?.toLowerCase() || "";
  const snippet = preview.snippet?.toLowerCase() || "";
  const combined = `${title} ${snippet}`;

  const {
    titleBlacklist = [],
    titleWhitelist = [],
    myStack = [],
    otherStack = [],
    minRelevanceForFetch = 0.3
  } = filterRules;

  // 1. Жёсткий blacklist по заголовку
  for (const pattern of titleBlacklist) {
    const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
    if (regex.test(title)) {
      return {
        pass: false,
        score: 0,
        reason: `title blacklist: ${pattern}`
      };
    }
  }

  // 2. Подсчёт совпадений стека
  const myStackHits = myStack.filter(tech =>
    combined.includes(tech.toLowerCase())
  ).length;

  const otherStackHits = otherStack.filter(tech =>
    combined.includes(tech.toLowerCase())
  ).length;

  // 3. Если чужой стек доминирует без моего
  if (otherStackHits > 0 && myStackHits === 0) {
    return {
      pass: false,
      score: 0.1,
      reason: `other stack dominates: ${otherStackHits} other vs ${myStackHits} my`
    };
  }

  // 4. Расчёт скора
  let score = 0.5; // базовый

  // Бонус за whitelist в заголовке
  for (const pattern of titleWhitelist) {
    const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
    if (regex.test(title)) {
      score += 0.3;
      break;
    }
  }

  // Бонус за мой стек
  score += Math.min(myStackHits * 0.1, 0.3);

  // Штраф за чужой стек (но не отклоняем, если есть мой)
  score -= Math.min(otherStackHits * 0.05, 0.2);

  // Ограничиваем диапазон [0, 1]
  score = Math.max(0, Math.min(1, score));

  return {
    pass: score >= minRelevanceForFetch,
    score: Math.round(score * 100) / 100,
    reason: score >= minRelevanceForFetch
      ? `accepted: my stack ${myStackHits}, other stack ${otherStackHits}`
      : `low score: ${score.toFixed(2)}`
  };
}

/**
 * Фильтрует массив превью вакансий
 * @param {Array} previews - массив превью
 * @returns {Object} { passed: Array, rejected: Array, stats: Object }
 */
export function filterPreviews(previews) {
  const passed = [];
  const rejected = [];

  for (const preview of previews) {
    const result = checkPreview(preview);

    if (result.pass) {
      passed.push({
        ...preview,
        preScore: result.score,
        preReason: result.reason
      });
    } else {
      rejected.push({
        ...preview,
        preScore: result.score,
        rejectReason: result.reason
      });
    }
  }

  // Сортируем прошедшие по скору (лучшие первыми)
  passed.sort((a, b) => b.preScore - a.preScore);

  // Статистика
  const stats = {
    total: previews.length,
    passed: passed.length,
    rejected: rejected.length,
    passRate: previews.length > 0
      ? Math.round((passed.length / previews.length) * 100)
      : 0
  };

  return { passed, rejected, stats };
}

/**
 * Получение статистики по причинам отклонения
 * @param {Array} rejected - массив отклонённых превью
 * @returns {Object} Статистика по причинам
 */
export function getRejectionStats(rejected) {
  const reasons = {};

  for (const item of rejected) {
    const reason = item.rejectReason || "unknown";
    const category = reason.includes("blacklist") ? "blacklist" :
                     reason.includes("other stack") ? "other_stack" :
                     reason.includes("low score") ? "low_score" : "other";

    reasons[category] = (reasons[category] || 0) + 1;
  }

  return reasons;
}

export default {
  loadFilterRules,
  getFilterRules,
  checkPreview,
  filterPreviews,
  getRejectionStats
};
