import fs from "fs/promises";
import path from "path";
import config from "./config.js";
import { normalizeCompanyName } from "./utils.js";

/**
 * Генерирует markdown-отчёт для одной вакансии
 * @param {Object} vacancy - Данные вакансии с анализом и письмом
 * @returns {string} Markdown-текст отчёта
 */
export function generateVacancyReport(vacancy) {
  const {
    id,
    url,
    title,
    company,
    salary,
    experience,
    description,
    analysis,
    coverLetter,
    companyResearch,
    companyQuestions,
    companySlug
  } = vacancy;

  // Относительный путь к JSON-файлу вакансии
  const jsonPath = `../../data/vacancies/${id}.json`;

  let report = `# ${title} - ${company}\n\n`;
  report += `**Ссылка на вакансию:** ${url}\n`;
  report += `**Исходные данные:** [${id}.json](${jsonPath})\n`;

  // Ссылка на отчет о компании
  if (companySlug) {
    report += `**О компании:** [${company}](../companies/${companySlug}.md)\n`;
  }

  report += `\n`;

  report += `## Информация о вакансии\n\n`;
  report += `- **Компания:** ${company}\n`;
  report += `- **Зарплата:** ${salary || "Не указана"}\n`;
  report += `- **Опыт работы:** ${experience || "Не указан"}\n`;
  report += `- **ID вакансии:** ${id}\n\n`;

  // Исследование компании
  if (companyResearch) {
    report += `## 🔍 Исследование компании\n\n`;

    if (companyResearch.status === "success" && companyResearch.analysis) {
      const ca = companyResearch.analysis;

      // Общая информация
      if (ca.overview) {
        report += `### О компании\n\n`;
        report += `${ca.overview.description}\n\n`;
        if (ca.overview.industry) {
          report += `**Отрасль:** ${ca.overview.industry}\n`;
        }
        if (ca.overview.size) {
          report += `**Размер:** ${ca.overview.size}\n`;
        }
        if (ca.overview.age) {
          report += `**На рынке:** ${ca.overview.age}\n`;
        }
        report += `\n`;
      }

      // Позитивные сигналы
      if (ca.positives && ca.positives.length > 0) {
        report += `### ✅ Позитивные сигналы\n\n`;
        ca.positives.forEach(p => {
          report += `- ${p}\n`;
        });
        report += `\n`;
      }

      // Red flags
      if (ca.redFlags && ca.redFlags.length > 0) {
        report += `### ⚠️ Red Flags\n\n`;
        ca.redFlags.forEach(r => {
          report += `- ${r}\n`;
        });
        report += `\n`;
      } else {
        report += `### ⚠️ Red Flags\n\n`;
        report += `- Не обнаружено\n\n`;
      }

      // Неизвестная информация
      if (ca.unknown && ca.unknown.length > 0) {
        report += `### ❓ Требует проверки\n\n`;
        ca.unknown.forEach(u => {
          report += `- ${u}\n`;
        });
        report += `\n`;
      }

      // Оценка надёжности
      if (ca.reliabilityScore !== null && ca.reliabilityScore !== undefined) {
        report += `### Оценка надёжности: ${ca.reliabilityScore}/10\n\n`;
        if (ca.reliabilitySummary) {
          report += `${ca.reliabilitySummary}\n\n`;
        }
      }

      // Источники
      if (ca.sources && ca.sources.length > 0) {
        report += `**Источники информации:**\n`;
        ca.sources.slice(0, 5).forEach(source => {
          report += `- ${source}\n`;
        });
        report += `\n`;
      }
    } else if (companyResearch.status === "insufficient_data") {
      report += `⚠️ Недостаточно информации о компании в открытых источниках.\n\n`;
    } else {
      report += `⚠️ Не удалось выполнить исследование компании.\n\n`;
    }
  }

  // Анализ вакансии
  if (analysis) {
    report += `## Анализ вакансии\n\n`;
    report += `**Соответствие резюме:** ${analysis.matchScore}/100\n\n`;

    if (analysis.offerProbability) {
      report += `**Вероятность получения оффера:** ${analysis.offerProbability}\n\n`;
    }

    if (analysis.pros && analysis.pros.length > 0) {
      report += `### Плюсы\n\n`;
      analysis.pros.forEach(pro => {
        report += `- ${pro}\n`;
      });
      report += `\n`;
    }

    if (analysis.cons && analysis.cons.length > 0) {
      report += `### Минусы\n\n`;
      analysis.cons.forEach(con => {
        report += `- ${con}\n`;
      });
      report += `\n`;
    }

    if (analysis.summary) {
      report += `### Резюме\n\n`;
      report += `${analysis.summary}\n\n`;
    }
  }

  // Вопросы компании
  if (companyQuestions && companyQuestions.length > 0) {
    report += `## 💬 Вопросы для собеседования\n\n`;
    report += `Важные вопросы, которые стоит задать на собеседовании:\n\n`;
    companyQuestions.forEach((question, index) => {
      report += `${index + 1}. ${question}\n`;
    });
    report += `\n`;
  }

  // Сопроводительное письмо
  if (coverLetter) {
    report += `## Сопроводительное письмо\n\n`;
    report += `${coverLetter}\n\n`;
  }

  // Краткое описание вакансии (первые 500 символов)
  if (description) {
    report += `## Описание вакансии\n\n`;
    const shortDescription = description.length > 500
      ? description.substring(0, 500) + "..."
      : description;
    report += `${shortDescription}\n\n`;
    report += `_Полное описание доступно в [исходных данных](${jsonPath})_\n`;
  }

  return report;
}

/**
 * Сохраняет отчёт по вакансии в файл output/vacancies/компания.md
 * @param {Object} vacancy - Данные вакансии
 * @returns {Promise<string>} Путь к сохранённому файлу
 */
export async function saveVacancyReport(vacancy) {
  const outputDir = path.join(config.paths.output, "vacancies");

  // Создаём папку, если её нет
  await fs.mkdir(outputDir, { recursive: true });

  // Генерируем имя файла на основе компании и ID
  const sanitizedCompany = normalizeCompanyName(vacancy.company);
  const fileName = `${sanitizedCompany}-${vacancy.id}.md`;
  const filePath = path.join(outputDir, fileName);

  // Генерируем отчёт
  const reportContent = generateVacancyReport(vacancy);

  // Сохраняем файл
  await fs.writeFile(filePath, reportContent, "utf8");

  console.log(`✅ Отчёт сохранён: ${fileName}`);

  return filePath;
}

/**
 * Генерирует сводный отчёт по всем вакансиям
 * @param {Array<Object>} vacancies - Массив вакансий с анализом
 * @param {Date} sessionStartTime - Время начала текущей сессии парсинга
 * @returns {string} Markdown-текст сводного отчёта
 */
export function generateSummaryReport(vacancies, sessionStartTime = null) {
  let report = `# Сводный отчёт по вакансиям\n\n`;
  report += `**Дата создания:** ${new Date().toLocaleString("ru-RU")}\n`;
  report += `**Всего вакансий:** ${vacancies.length}\n\n`;

  // Определяем новые вакансии (найденные в текущей сессии)
  const newVacancies = [];
  const oldVacancies = [];

  vacancies.forEach(v => {
    if (sessionStartTime && v.firstSeenAt) {
      const firstSeenDate = new Date(v.firstSeenAt);
      if (firstSeenDate >= sessionStartTime) {
        newVacancies.push(v);
      } else {
        oldVacancies.push(v);
      }
    } else {
      // Если нет данных о времени, считаем старыми
      oldVacancies.push(v);
    }
  });

  // Сортируем обе группы по matchScore
  const sortByScore = (a, b) => {
    const scoreA = a.analysis?.matchScore || 0;
    const scoreB = b.analysis?.matchScore || 0;
    return scoreB - scoreA;
  };

  newVacancies.sort(sortByScore);
  oldVacancies.sort(sortByScore);

  // Объединяем: новые первыми
  const sortedVacancies = [...newVacancies, ...oldVacancies];

  // Статистика
  const avgScore = sortedVacancies.reduce((sum, v) => sum + (v.analysis?.matchScore || 0), 0) / vacancies.length;
  const highMatchCount = sortedVacancies.filter(v => (v.analysis?.matchScore || 0) >= 70).length;
  const mediumMatchCount = sortedVacancies.filter(v => {
    const score = v.analysis?.matchScore || 0;
    return score >= 40 && score < 70;
  }).length;
  const lowMatchCount = sortedVacancies.filter(v => (v.analysis?.matchScore || 0) < 40).length;

  report += `## Статистика\n\n`;
  report += `- **Средний уровень соответствия:** ${avgScore.toFixed(1)}/100\n`;
  report += `- **Высокое соответствие (≥70):** ${highMatchCount} вакансий\n`;
  report += `- **Среднее соответствие (40-69):** ${mediumMatchCount} вакансий\n`;
  report += `- **Низкое соответствие (<40):** ${lowMatchCount} вакансий\n`;

  if (newVacancies.length > 0) {
    report += `- **🆕 Новых вакансий:** ${newVacancies.length}\n`;
  }
  report += `\n`;

  // Топ-5 вакансий
  report += `## Топ-5 рекомендованных вакансий\n\n`;
  const top5 = sortedVacancies.slice(0, 5);

  top5.forEach((vacancy, index) => {
    const sanitizedCompany = normalizeCompanyName(vacancy.company);
    const reportLink = `vacancies/${sanitizedCompany}-${vacancy.id}.md`;
    const isNew = newVacancies.includes(vacancy);

    report += `### ${index + 1}. ${vacancy.title} - ${vacancy.company}${isNew ? " 🆕" : ""}\n\n`;
    report += `- **Соответствие:** ${vacancy.analysis?.matchScore || 0}/100\n`;
    report += `- **Зарплата:** ${vacancy.salary || "Не указана"}\n`;
    report += `- **Ссылка:** ${vacancy.url}\n`;
    report += `- **Отчёт:** [Подробнее](${reportLink})\n`;

    if (vacancy.firstSeenAt) {
      const firstSeenDate = new Date(vacancy.firstSeenAt);
      report += `- **Найдена:** ${firstSeenDate.toLocaleString("ru-RU", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })}\n`;
    }

    report += `\n`;

    if (vacancy.analysis?.summary) {
      report += `${vacancy.analysis.summary}\n\n`;
    }
  });

  // Все вакансии списком
  report += `## Все вакансии\n\n`;

  if (newVacancies.length > 0) {
    report += `### 🆕 Новые вакансии\n\n`;
    newVacancies.forEach(vacancy => {
      const sanitizedCompany = normalizeCompanyName(vacancy.company);
      const reportLink = `vacancies/${sanitizedCompany}-${vacancy.id}.md`;
      const score = vacancy.analysis?.matchScore || 0;

      report += `- [${vacancy.title} - ${vacancy.company}](${reportLink}) - ${score}/100`;

      if (vacancy.firstSeenAt) {
        const firstSeenDate = new Date(vacancy.firstSeenAt);
        report += ` — найдена ${firstSeenDate.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })}`;
      }

      report += `\n`;
    });
    report += `\n`;
  }

  if (oldVacancies.length > 0) {
    report += `### Ранее найденные вакансии\n\n`;
    oldVacancies.forEach(vacancy => {
      const sanitizedCompany = normalizeCompanyName(vacancy.company);
      const reportLink = `vacancies/${sanitizedCompany}-${vacancy.id}.md`;
      const score = vacancy.analysis?.matchScore || 0;

      report += `- [${vacancy.title} - ${vacancy.company}](${reportLink}) - ${score}/100`;

      if (vacancy.firstSeenAt) {
        const firstSeenDate = new Date(vacancy.firstSeenAt);
        report += ` — найдена ${firstSeenDate.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })}`;
      }

      report += `\n`;
    });
  }

  return report;
}

/**
 * Сохраняет сводный отчёт в файл output/summary.md
 * @param {Array<Object>} vacancies - Массив вакансий
 * @param {Date} sessionStartTime - Время начала текущей сессии парсинга
 * @returns {Promise<string>} Путь к сохранённому файлу
 */
export async function saveSummaryReport(vacancies, sessionStartTime = null) {
  const outputDir = config.paths.output;
  await fs.mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, "summary.md");
  const reportContent = generateSummaryReport(vacancies, sessionStartTime);

  await fs.writeFile(filePath, reportContent, "utf8");

  console.log(`✅ Сводный отчёт сохранён: summary.md`);

  return filePath;
}

/**
 * Генерирует markdown-отчёт о компании
 * @param {string} companyName - Название компании
 * @param {Object} companyResearch - Результат исследования компании
 * @param {Array<Object>} relatedVacancies - Связанные вакансии этой компании
 * @returns {string} Markdown-текст отчёта
 */
export function generateCompanyReport(companyName, companyResearch, relatedVacancies = []) {
  let report = `# ${companyName}\n\n`;
  report += `**Дата исследования:** ${new Date().toLocaleString("ru-RU")}\n`;
  report += `**Количество проанализированных вакансий:** ${relatedVacancies.length}\n\n`;

  if (companyResearch && companyResearch.status === "success" && companyResearch.analysis) {
    const ca = companyResearch.analysis;

    // Общая информация
    if (ca.overview) {
      report += `## О компании\n\n`;
      report += `${ca.overview.description}\n\n`;

      if (ca.overview.industry) {
        report += `**Отрасль:** ${ca.overview.industry}\n`;
      }
      if (ca.overview.size) {
        report += `**Размер:** ${ca.overview.size}\n`;
      }
      if (ca.overview.age) {
        report += `**На рынке:** ${ca.overview.age}\n`;
      }
      report += `\n`;
    }

    // Оценка надёжности
    if (ca.reliabilityScore !== null && ca.reliabilityScore !== undefined) {
      report += `## Оценка надёжности: ${ca.reliabilityScore}/10\n\n`;
      if (ca.reliabilitySummary) {
        report += `${ca.reliabilitySummary}\n\n`;
      }
    }

    // Позитивные сигналы
    if (ca.positives && ca.positives.length > 0) {
      report += `## ✅ Преимущества работы в компании\n\n`;
      ca.positives.forEach(p => {
        report += `- ${p}\n`;
      });
      report += `\n`;
    }

    // Red flags
    if (ca.redFlags && ca.redFlags.length > 0) {
      report += `## ⚠️ Настораживающие факторы (Red Flags)\n\n`;
      ca.redFlags.forEach(r => {
        report += `- ${r}\n`;
      });
      report += `\n`;
    } else {
      report += `## ⚠️ Настораживающие факторы (Red Flags)\n\n`;
      report += `Не обнаружено серьезных красных флагов.\n\n`;
    }

    // Неизвестная информация
    if (ca.unknown && ca.unknown.length > 0) {
      report += `## ❓ Требует уточнения на собеседовании\n\n`;
      ca.unknown.forEach(u => {
        report += `- ${u}\n`;
      });
      report += `\n`;
    }

    // Источники
    if (ca.sources && ca.sources.length > 0) {
      report += `## Источники информации\n\n`;
      ca.sources.slice(0, 10).forEach(source => {
        report += `- ${source}\n`;
      });
      report += `\n`;
    }
  } else if (companyResearch && companyResearch.status === "insufficient_data") {
    report += `## ⚠️ Недостаточно данных\n\n`;
    report += `К сожалению, недостаточно информации о компании в открытых источниках. Рекомендуется задать дополнительные вопросы на собеседовании.\n\n`;
  } else {
    report += `## ⚠️ Исследование недоступно\n\n`;
    report += `Не удалось провести исследование компании.\n\n`;
  }

  // Связанные вакансии
  if (relatedVacancies.length > 0) {
    report += `## Вакансии компании\n\n`;
    relatedVacancies.forEach(vacancy => {
      const sanitizedCompany = normalizeCompanyName(vacancy.company);
      const vacancyLink = `../vacancies/${sanitizedCompany}-${vacancy.id}.md`;
      const score = vacancy.analysis?.matchScore || "N/A";

      report += `- [${vacancy.title}](${vacancyLink}) - Соответствие: ${score}/100\n`;
    });
    report += `\n`;
  }

  return report;
}

/**
 * Сохраняет отчёт о компании в файл output/companies/{slug}.md
 * @param {string} companySlug - Нормализованное название компании
 * @param {string} companyName - Оригинальное название компании
 * @param {Object} companyResearch - Результат исследования
 * @param {Array<Object>} relatedVacancies - Связанные вакансии
 * @returns {Promise<string>} Путь к сохранённому файлу
 */
export async function saveCompanyReport(companySlug, companyName, companyResearch, relatedVacancies = []) {
  const outputDir = path.join(config.paths.output, "companies");

  // Создаём папку, если её нет
  await fs.mkdir(outputDir, { recursive: true });

  const fileName = `${companySlug}.md`;
  const filePath = path.join(outputDir, fileName);

  // Генерируем отчёт
  const reportContent = generateCompanyReport(companyName, companyResearch, relatedVacancies);

  // Сохраняем файл
  await fs.writeFile(filePath, reportContent, "utf8");

  console.log(`✅ Отчёт о компании сохранён: companies/${fileName}`);

  return filePath;
}
