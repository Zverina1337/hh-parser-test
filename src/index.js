#!/usr/bin/env node

import dotenv from "dotenv";

// ВАЖНО: загружаем .env перед импортом других модулей
dotenv.config();
import { fetchPage, parseSearchPage, parseVacancyPage, delay, buildSearchUrl } from "./parser.js";
import { isProcessed, saveVacancy, updateStatus, loadVacancy, getAllVacancies, loadVacanciesByStatus, getCompanySlug, saveCompanyToRegistry, isCompanyInRegistry, getAnalyzedWithoutReports, markReportGenerated } from "./storage.js";
import { retryWithBackoff, quickScore, deepAnalyze, processVacanciesInParallel, generateHumanCoverLetter } from "./analyzer.js";
// import { getCompanyResearch } from "./researcher.js"; // ВРЕМЕННО ОТКЛЮЧЕНО
import { saveSummaryReport, saveVacancyReport, saveCompanyReport } from "./report.js";
import { loadProcessedResume, loadPreFilterRules } from "./resume-cache.js";
import { getSearchFilters } from "./filters.js";
import { loadFilterRules, filterPreviews, getRejectionStats } from "./preFilter.js";
import { loadKeywords, containsStopWords } from "./keywords-extractor.js";
import config from "./config.js";
import timer from "./timer.js";
import stats from "./stats.js";

// Парсинг CLI аргументов
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: "full",  // parse | analyze | full | refresh-resume | refresh-filters
    query: null,
    limit: config.parsing.defaultLimit,
    refreshResume: false,
    refreshFilters: false,
    useFilters: true,  // По умолчанию используем фильтры на основе резюме
    minScore: config.funnel.quickScore.minScore,  // Минимальный скор для глубокого анализа
    topN: config.funnel.deepAnalysis.topN,  // Количество топовых вакансий для глубокого анализа
    parallelRequests: config.funnel.deepAnalysis.parallelRequests  // Параллелизм
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      options.mode = args[i + 1];
      i++;
    } else if (args[i] === "--query" && args[i + 1]) {
      options.query = args[i + 1];
      i++;
    } else if (args[i] === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--refresh-resume") {
      options.refreshResume = true;
    } else if (args[i] === "--refresh-filters") {
      options.refreshFilters = true;
    } else if (args[i] === "--no-filters") {
      options.useFilters = false;
    } else if (args[i] === "--min-score" && args[i + 1]) {
      options.minScore = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--top-n" && args[i + 1]) {
      options.topN = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === "--parallel" && args[i + 1]) {
      options.parallelRequests = parseInt(args[i + 1]);
      i++;
    }
  }

  return options;
}

// Парсинг вакансий с пагинацией
async function parseVacancies(query, limit, useFilters = true, forceRegenerate = false) {
  timer.start("search");

  let filters;
  let preFilterEnabled = false;

  if (useFilters) {
    console.log(`\n🔍 Генерация фильтров на основе резюме...`);
    try {
      filters = await getSearchFilters(query, forceRegenerate);
      console.log(`✅ Фильтры успешно сгенерированы`);
      console.log(`📋 Параметры поиска:`, JSON.stringify(filters, null, 2));

      // Загружаем правила preFilter
      if (config.preFilter?.enabled !== false) {
        console.log(`\n🎯 Загрузка правил предварительной фильтрации...`);
        const preFilterRules = await loadPreFilterRules(forceRegenerate);
        if (preFilterRules) {
          loadFilterRules(preFilterRules);
          preFilterEnabled = true;
          console.log(`✅ PreFilter активирован`);
          console.log(`   Целевая роль: ${preFilterRules.targetRole || "не указана"}`);
          console.log(`   Мой стек: ${preFilterRules.myStack?.slice(0, 5).join(", ")}${preFilterRules.myStack?.length > 5 ? "..." : ""}`);
          console.log(`   Blacklist: ${preFilterRules.titleBlacklist?.length || 0} правил`);
          console.log(`   Whitelist: ${preFilterRules.titleWhitelist?.length || 0} правил`);
        }
      }
    } catch (error) {
      console.error(`❌ Ошибка генерации фильтров: ${error.message}`);
      console.log(`⚠️  Используется обычный поиск без фильтров`);
      filters = query;
    }
  } else {
    console.log(`\n🔍 Поиск вакансий без фильтров: "${query}"`);
    filters = query;
  }

  // Подсчитываем уже спаршенные вакансии, которые нужно добавить в воронку
  const parsedVacancies = await loadVacanciesByStatus("parsed");
  const readyForDeepVacancies = await loadVacanciesByStatus("ready_for_deep");
  const existingCount = parsedVacancies.length + readyForDeepVacancies.length;

  if (existingCount > 0) {
    console.log(`\n📦 Уже есть спаршенные вакансии для обработки:`);
    console.log(`   • parsed (ожидают скоринга): ${parsedVacancies.length}`);
    console.log(`   • ready_for_deep (ожидают анализа): ${readyForDeepVacancies.length}`);
    console.log(`   ИТОГО: ${existingCount} вакансий`);
  }

  // Вычисляем, сколько новых вакансий нужно спарсить
  const needToParse = Math.max(0, limit - existingCount);

  console.log(`\n📊 Целевое количество вакансий: ${limit}`);
  console.log(`📊 Нужно спарсить новых: ${needToParse}\n`);

  if (needToParse === 0) {
    console.log(`✅ Уже достаточно вакансий для обработки (${existingCount}/${limit})`);
    console.log(`   Пропускаем парсинг и переходим к воронке\n`);
    const searchTime = timer.stop("search");
    console.log(`⏱️  Время: ${timer.format(searchTime)}\n`);
    return;
  }

  // Загружаем стоп-слова для фильтрации на этапе парсинга
  let stopWords = [];
  if (useFilters) {
    console.log(`🔍 Загрузка стоп-слов для фильтрации...`);
    const keywords = await loadKeywords();
    stopWords = keywords.stopWords || [];
    if (stopWords.length > 0) {
      console.log(`✅ Стоп-слова: ${stopWords.join(", ")}\n`);
    }
  }

  let parsed = 0;
  let skipped = 0;
  let preFiltered = 0;
  let stopWordsFiltered = 0;
  let lowPreScoreSkipped = 0;  // Счётчик вакансий, пропущенных по minPreScore
  let page = 0;
  let totalFound = 0;
  let totalAdvertised = 0;

  // Выводим информацию о фильтрации рекламы
  if (config.parsing.filterAdvertised) {
    console.log(`\n⚠️  Фильтрация рекламных вакансий: ВКЛЮЧЕНА`);
    console.log(`   Рекламные вакансии (adsrv.hh.ru) будут исключены из результатов`);
    console.log(`   Чтобы отключить фильтрацию, установите parsing.filterAdvertised: false в config.js\n`);
  }

  // Выводим информацию о minPreScore
  const minPreScore = config.preFilter?.minPreScore || 0;
  if (minPreScore > 0) {
    console.log(`🎯 Минимальный preScore: ${minPreScore}`);
    console.log(`   Вакансии с preScore < ${minPreScore} будут пропущены без сохранения\n`);
  }

  // Парсим страницы, пока не достигнем нужного количества или не закончатся вакансии
  // Нет жёсткого лимита по страницам — парсим пока не наберём нужное количество
  while (parsed < needToParse) {
    const searchUrl = buildSearchUrl(filters, page);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📄 Страница ${page + 1} | Прогресс: ${parsed}/${needToParse} новых вакансий`);
    console.log(`${"=".repeat(60)}`);

    try {
      // Загружаем страницу поиска
      const html = await fetchPage(searchUrl);
      const result = parseSearchPage(html, config.parsing.filterAdvertised);

      if (result.vacancies.length === 0) {
        console.log("✅ Больше вакансий не найдено на hh.ru");
        break;
      }

      totalFound += result.vacancies.length;
      totalAdvertised += result.advertisedCount;

      console.log(`   Найдено ${result.vacancies.length} вакансий на странице (всего найдено: ${totalFound})`);
      if (result.advertisedCount > 0) {
        console.log(`   🚫 Отфильтровано рекламных: ${result.advertisedCount} (всего отфильтровано: ${totalAdvertised})`);
      }

      // Применяем предварительную фильтрацию по превью
      let vacanciesToProcess = result.vacancies;

      if (preFilterEnabled) {
        const filterResult = filterPreviews(result.vacancies);
        vacanciesToProcess = filterResult.passed;
        preFiltered += filterResult.rejected.length;

        console.log(`   🎯 PreFilter: ${filterResult.stats.passed} прошли, ${filterResult.stats.rejected} отклонены (${filterResult.stats.passRate}% pass rate)`);

        // Показываем статистику по причинам отклонения
        if (filterResult.rejected.length > 0) {
          const rejectionStats = getRejectionStats(filterResult.rejected);
          const reasons = Object.entries(rejectionStats)
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(", ");
          console.log(`   📊 Причины отклонения: ${reasons}`);
        }
      }

      console.log();

      // Обрабатываем вакансии с текущей страницы
      for (const preview of vacanciesToProcess) {
        // Проверяем, не достигнут ли лимит
        if (parsed >= needToParse) {
          console.log(`\n✅ Достигнут лимит: ${needToParse} новых вакансий`);
          break;
        }

        const { id, url } = preview;

        // Пропускаем уже обработанные
        if (await isProcessed(id)) {
          console.log(`⏭️  Пропущена (уже обработана): ${id}`);
          skipped++;
          continue;
        }

        // Фильтрация по стоп-словам (до парсинга полной страницы)
        if (stopWords.length > 0 && containsStopWords(preview.title, stopWords)) {
          console.log(`🚫 Отфильтрована по стоп-словам: ${preview.title} (${id})`);
          stopWordsFiltered++;
          continue;
        }

        // Фильтрация по minPreScore (если preScore слишком низкий — не сохраняем вакансию)
        if (minPreScore > 0 && preview.preScore !== undefined && preview.preScore < minPreScore) {
          console.log(`⏭️  Пропущена (preScore ${preview.preScore} < ${minPreScore}): ${preview.title} (${id})`);
          lowPreScoreSkipped++;
          continue;
        }

        try {
          timer.start(`parse-${id}`);
          const preScoreInfo = preview.preScore ? ` [preScore: ${preview.preScore}]` : "";
          console.log(`⬇️  Парсинг вакансии ${parsed + 1}/${needToParse}: ${preview.title}${preScoreInfo}...`);

          const vacancyHtml = await fetchPage(url, 'vacancy');
          const vacancy = parseVacancyPage(vacancyHtml, url);

          // Сохраняем preScore если есть
          if (preview.preScore) {
            vacancy.preScore = preview.preScore;
            vacancy.preReason = preview.preReason;
          }

          await saveVacancy(vacancy);
          await updateStatus(id, "parsed");

          const parseTime = timer.stop(`parse-${id}`);
          timer.addTime("parse", parseTime);
          parsed++;

          console.log(`✅ Сохранена: ${vacancy.title} (${vacancy.company}) [${timer.format(parseTime)}]`);

          // Задержка между парсингом вакансий
          if (parsed < needToParse) {
            await delay(config.delays.min, config.delays.max);
          }
        } catch (error) {
          console.error(`❌ Ошибка при парсинге ${id}: ${error.message}`);
          // Не меняем статус при ошибке - оставляем последний
        }
      }

      // Если достигнут лимит, выходим из цикла страниц
      if (parsed >= needToParse) {
        break;
      }

      // Переходим на следующую страницу
      page++;

      // Задержка между страницами поиска
      if (parsed < needToParse) {
        const delayTime = Math.floor(Math.random() * (config.delays.max - config.delays.min + 1)) + config.delays.min;
        console.log(`\n⏳ Переход на следующую страницу через ${Math.round(delayTime / 1000)} сек...`);
        await delay(config.delays.min, config.delays.max);
      }

    } catch (error) {
      console.error(`❌ Ошибка при загрузке страницы поиска: ${error.message}`);
      break;
    }
  }

  const searchTime = timer.stop("search");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 ИТОГОВАЯ СТАТИСТИКА ПАРСИНГА`);
  console.log(`${"=".repeat(60)}`);
  console.log(`   🔍 Всего найдено на hh.ru: ${totalFound} вакансий`);
  if (totalAdvertised > 0 && config.parsing.filterAdvertised) {
    console.log(`   🚫 Отфильтровано рекламных: ${totalAdvertised} вакансий`);
  }
  if (preFiltered > 0) {
    console.log(`   🎯 Отклонено PreFilter: ${preFiltered} вакансий`);
  }
  if (stopWordsFiltered > 0) {
    console.log(`   🚫 Отфильтровано по стоп-словам: ${stopWordsFiltered} вакансий`);
  }
  if (lowPreScoreSkipped > 0) {
    console.log(`   ⏭️  Пропущено по minPreScore: ${lowPreScoreSkipped} вакансий`);
  }
  console.log(`   📄 Обработано страниц: ${page + 1}`);
  console.log(`   ✅ Спарсено новых: ${parsed}`);
  console.log(`   ⏭️  Пропущено (уже есть): ${skipped}`);
  console.log(`   ⏱️  Время: ${timer.format(searchTime)}`);

  if (parsed > 0) {
    const avgTime = searchTime / parsed;
    console.log(`   ⚡ Среднее время на вакансию: ${timer.format(avgTime)}`);
  }

  console.log(`${"=".repeat(60)}`);

  // Итоговая статистика по всем вакансиям (включая уже существующие)
  const totalForProcessing = existingCount + parsed;
  console.log(`\n📦 ВСЕГО ВАКАНСИЙ ДЛЯ ОБРАБОТКИ: ${totalForProcessing}`);
  console.log(`   • Уже были спаршены: ${existingCount}`);
  console.log(`   • Спарсено сейчас: ${parsed}`);
  console.log(`${"=".repeat(60)}\n`);

  console.log(`✨ Парсинг завершён!\n`);
}

// Этап 2: Быстрый скоринг вакансий
async function quickScoreVacancies(minScore = 5) {
  console.log("\n⚡ Этап 2: Быстрый скоринг вакансий\n");

  // Загружаем все спарсенные вакансии
  const parsedVacancies = await loadVacanciesByStatus("parsed");

  if (parsedVacancies.length === 0) {
    console.log("ℹ️  Нет вакансий для скоринга");
    return;
  }

  console.log(`📊 Найдено вакансий для скоринга: ${parsedVacancies.length}\n`);

  // Быстрый скоринг через LLM (batch-запрос)
  // Примечание: фильтрация по стоп-словам теперь происходит на Этапе 1 (до парсинга)
  console.log("🤖 Быстрый скоринг через AI (batch-запрос)...\n");
  timer.start("quick-score");

  try {
    const scores = await retryWithBackoff(() =>
      quickScore(parsedVacancies, null, config.funnel.quickScore.descriptionLength)
    );

    const scoreTime = timer.stop("quick-score");
    console.log(`✅ Скоринг завершен [${timer.format(scoreTime)}]\n`);

    // Сохраняем скоры и обновляем статусы
    let readyForDeep = 0;
    let lowScore = 0;

    for (const scoreData of scores) {
      const vacancy = parsedVacancies.find(v => v.id === scoreData.id);
      if (!vacancy) continue;

      // Сохраняем quickScore в вакансии
      vacancy.quickScore = scoreData.score;
      vacancy.quickScoreReason = scoreData.reason;
      await saveVacancy(vacancy);

      // Обновляем статус в зависимости от скора
      if (scoreData.score >= minScore) {
        await updateStatus(scoreData.id, "ready_for_deep", { quickScore: scoreData.score });
        readyForDeep++;
        console.log(`✅ ${vacancy.title} - Скор: ${scoreData.score}/10 → Готова к глубокому анализу`);
      } else {
        await updateStatus(scoreData.id, "quick_scored", { quickScore: scoreData.score });
        lowScore++;
        console.log(`⏭️  ${vacancy.title} - Скор: ${scoreData.score}/10 → Низкий приоритет`);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 СТАТИСТИКА СКОРИНГА`);
    console.log(`${"=".repeat(60)}`);
    console.log(`   ✅ Готовы к глубокому анализу (≥${minScore}): ${readyForDeep}`);
    console.log(`   ⏭️  Низкий приоритет (<${minScore}): ${lowScore}`);
    console.log(`   ⏱️  Время: ${timer.format(scoreTime)}`);
    console.log(`${"=".repeat(60)}\n`);

  } catch (error) {
    console.error(`❌ Ошибка при скоринге: ${error.message}`);
    throw error;
  }
}

// Этап 3: Глубокий анализ топовых вакансий
async function deepAnalyzeVacancies(topN = 10, parallelRequests = 3) {
  console.log(`\n🎯 Этап 3: Глубокий анализ топ-${topN} вакансий\n`);

  // Загружаем вакансии, готовые к глубокому анализу
  const readyVacancies = await loadVacanciesByStatus("ready_for_deep");

  if (readyVacancies.length === 0) {
    console.log("ℹ️  Нет вакансий для глубокого анализа");
    return;
  }

  // Сортируем по quickScore (от большего к меньшему)
  readyVacancies.sort((a, b) => (b.quickScore || 0) - (a.quickScore || 0));

  // Берем топ-N
  const topVacancies = readyVacancies.slice(0, topN);

  console.log(`📊 Доступно вакансий: ${readyVacancies.length}`);
  console.log(`🎯 Анализируем топ-${topVacancies.length} вакансий`);
  console.log(`⚡ Параллелизм: ${parallelRequests} одновременных запросов\n`);

  timer.start("deep-analyze");

  // Обработка глубокого анализа
  const { results, errors } = await processVacanciesInParallel(
    topVacancies,
    async (vacancy) => {
      console.log(`🔍 Глубокий анализ: ${vacancy.title} (${vacancy.id})...`);

      // Комплексный анализ (один запрос: анализ + вопросы + keyFacts)
      // Примечание: исследование компаний (researcher) временно отключено
      console.log(`🤖 Комплексный анализ вакансии...`);
      const deepResult = await deepAnalyze(vacancy, null, null);

      // 3. Генерация сопроводительного письма (отдельный запрос для качества)
      console.log(`✉️  Генерация сопроводительного письма...`);
      const coverLetter = await generateHumanCoverLetter(deepResult.keyFacts);

      // Получаем slug компании
      const companySlug = await getCompanySlug(vacancy.company);

      // Регистрируем компанию, если её ещё нет
      if (!(await isCompanyInRegistry(vacancy.company))) {
        await saveCompanyToRegistry(vacancy.company, companySlug, {
          firstSeenAt: new Date().toISOString()
        });
      }

      console.log(`✅ Завершено: ${vacancy.title} - Match: ${deepResult.vacancyAnalysis.matchScore}/100`);

      return {
        analysis: deepResult.vacancyAnalysis,
        coverLetter,
        keyFacts: deepResult.keyFacts,
        companyResearch: deepResult.companyResearch,
        companyQuestions: deepResult.companyQuestions,
        companySlug
      };
    },
    parallelRequests
  );

  const deepTime = timer.stop("deep-analyze");

  // Сохраняем результаты
  for (const { vacancy, result } of results) {
    vacancy.analysis = result.analysis;
    vacancy.coverLetter = result.coverLetter;
    vacancy.keyFacts = result.keyFacts;  // Сохраняем ключевые факты
    vacancy.companyResearch = result.companyResearch;
    vacancy.companyQuestions = result.companyQuestions;
    vacancy.companySlug = result.companySlug;
    await saveVacancy(vacancy);
    await updateStatus(vacancy.id, "analyzed");
  }

  // Логируем ошибки
  for (const { vacancy, error } of errors) {
    console.error(`❌ Ошибка при анализе ${vacancy.id}: ${error}`);
    // Не меняем статус при ошибке - вакансия останется в ready_for_deep для повторной попытки
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 СТАТИСТИКА ГЛУБОКОГО АНАЛИЗА`);
  console.log(`${"=".repeat(60)}`);
  console.log(`   ✅ Успешно проанализировано: ${results.length}`);
  console.log(`   ❌ Ошибок: ${errors.length}`);
  console.log(`   ⏱️  Время: ${timer.format(deepTime)}`);
  if (results.length > 0) {
    const avgTime = deepTime / results.length;
    console.log(`   ⚡ Среднее время на вакансию: ${timer.format(avgTime)}`);
  }
  console.log(`${"=".repeat(60)}\n`);
}


// Генерация отчётов (инкрементальная)
async function generateReports(sessionStartTime = null) {
  timer.start("report");
  console.log("\n📝 Генерация отчётов...\n");

  // Получаем ID вакансий без отчётов
  const vacanciesWithoutReports = await getAnalyzedWithoutReports();

  if (vacanciesWithoutReports.length === 0) {
    console.log("ℹ️  Нет новых проанализированных вакансий для генерации детальных отчётов");
    console.log("   Будет обновлён только сводный отчёт\n");
  } else {
    // Загружаем только новые вакансии
    console.log(`📄 Генерация детальных отчётов для ${vacanciesWithoutReports.length} новых вакансий...\n`);

    const newVacancies = await Promise.all(
      vacanciesWithoutReports.map(id => loadVacancy(id))
    );

    // Генерируем отчёты для новых вакансий
    for (const vacancy of newVacancies) {
      try {
        await saveVacancyReport(vacancy);
        await markReportGenerated(vacancy.id);
      } catch (error) {
        console.error(`❌ Ошибка при создании отчёта для ${vacancy.id}: ${error.message}`);
      }
    }

    console.log();

    // Генерируем/обновляем отчёты о компаниях (только для новых вакансий)
    console.log(`🏢 Обновление отчётов о компаниях...\n`);

    // Группируем новые вакансии по компаниям
    const companiesMap = new Map();
    for (const vacancy of newVacancies) {
      const companyName = vacancy.company;
      if (!companiesMap.has(companyName)) {
        companiesMap.set(companyName, {
          vacancies: [],
          research: vacancy.companyResearch,
          slug: vacancy.companySlug
        });
      }
      companiesMap.get(companyName).vacancies.push(vacancy);
    }

    // Для каждой компании загружаем ВСЕ её вакансии и перегенерируем отчёт
    for (const [companyName, data] of companiesMap) {
      try {
        const slug = data.slug || await getCompanySlug(companyName);

        // Загружаем все вакансии компании (включая старые)
        const allVacancies = await getAllVacancies();
        const companyVacancies = allVacancies.filter(
          v => v.company === companyName && v.analysis && v.coverLetter
        );

        await saveCompanyReport(slug, companyName, data.research, companyVacancies);
      } catch (error) {
        console.error(`❌ Ошибка при создании отчёта о компании ${companyName}: ${error.message}`);
      }
    }

    console.log();
  }

  // Сводный отчёт всегда обновляется (по всем проанализированным вакансиям)
  const allVacancies = await getAllVacancies();
  const analyzedVacancies = allVacancies.filter(v => v.analysis && v.coverLetter);

  if (analyzedVacancies.length === 0) {
    console.log("⚠️  Нет проанализированных вакансий для сводного отчёта\n");
    return;
  }

  const summaryPath = await saveSummaryReport(analyzedVacancies, sessionStartTime);
  const reportTime = timer.stop("report");
  console.log(`✅ Сводный отчёт обновлён: ${summaryPath} [${timer.format(reportTime)}]`);

  console.log("\n✨ Отчёты сгенерированы\n");
}

// Graceful shutdown
let isShuttingDown = false;

process.on("SIGINT", () => {
  if (isShuttingDown) {
    console.log("\n⚠️  Принудительное завершение...");
    process.exit(1);
  }

  console.log("\n⏸️  Остановка... (Нажмите Ctrl+C ещё раз для принудительного завершения)");
  isShuttingDown = true;

  setTimeout(() => {
    console.log("✅ Состояние сохранено");
    process.exit(0);
  }, 1000);
});

// Главная функция
async function main() {
  timer.start("total");
  console.log("🚀 HH-Parser: Парсер вакансий с AI-анализом\n");

  // Проверка наличия API ключа
  if (!process.env.GROQ_API_KEY) {
    console.error("❌ GROQ_API_KEY не найден в переменных окружения");
    console.error("   Скопируйте .env.example в .env и добавьте ваш ключ");
    process.exit(1);
  }

  const options = parseArgs();
  const sessionStartTime = new Date();  // Время начала текущей сессии

  try {
    // Режим переобработки резюме
    if (options.mode === "refresh-resume") {
      console.log("🔄 Переобработка резюме...\n");
      try {
        const processed = await loadProcessedResume(true);
        console.log("✅ Резюме успешно переобработано\n");
        console.log("📋 Структурированное резюме:");
        console.log(JSON.stringify(processed, null, 2));
      } catch (error) {
        console.error(`❌ Ошибка при обработке резюме: ${error.message}`);
        process.exit(1);
      }
      return;
    }

    // Режим переобработки фильтров
    if (options.mode === "refresh-filters") {
      console.log("🔄 Переобработка фильтров на основе резюме...\n");
      try {
        const filters = await getSearchFilters("", true);
        console.log("✅ Фильтры успешно сгенерированы\n");
        console.log("📋 Параметры поиска:");
        console.log(JSON.stringify(filters, null, 2));
      } catch (error) {
        console.error(`❌ Ошибка при генерации фильтров: ${error.message}`);
        process.exit(1);
      }
      return;
    }

    if (options.mode === "parse") {
      if (!options.query && options.useFilters === false) {
        console.error("❌ Для режима parse требуется параметр --query (если используется --no-filters)");
        process.exit(1);
      }
      await parseVacancies(options.query || "", options.limit, options.useFilters, options.refreshFilters);
    } else if (options.mode === "analyze") {
      // Режим analyze: анализ ТОЛЬКО вакансий со статусом ready_for_deep
      console.log("🔄 Режим: Анализ вакансий, готовых к глубокому анализу (ready_for_deep)\n");

      const readyVacancies = await loadVacanciesByStatus("ready_for_deep");

      if (readyVacancies.length === 0) {
        console.log("ℹ️  Нет вакансий со статусом ready_for_deep для анализа");
        console.log("   Запустите npm run full для парсинга и скоринга новых вакансий\n");
      } else {
        console.log(`📊 Найдено ${readyVacancies.length} вакансий для глубокого анализа`);
        console.log(`⚡ Будут проанализированы ВСЕ вакансии (без ограничения topN)\n`);

        // Глубокий анализ всех вакансий ready_for_deep
        await deepAnalyzeVacancies(readyVacancies.length, options.parallelRequests);
      }

      // Генерация отчётов
      await generateReports(sessionStartTime);
    } else if (options.mode === "funnel") {
      // Новый режим: трехэтапная воронка (только этапы 2-3)
      await quickScoreVacancies(options.minScore);
      await deepAnalyzeVacancies(options.topN, options.parallelRequests);
      await generateReports(sessionStartTime);
    } else if (options.mode === "full") {
      if (!options.query && options.useFilters === false) {
        console.error("❌ Для режима full требуется параметр --query (если используется --no-filters)");
        process.exit(1);
      }
      // Полный цикл с трехэтапной воронкой
      await parseVacancies(options.query || "", options.limit, options.useFilters, options.refreshFilters);
      await quickScoreVacancies(options.minScore);
      await deepAnalyzeVacancies(options.topN, options.parallelRequests);
      await generateReports(sessionStartTime);
    } else {
      console.error(`❌ Неизвестный режим: ${options.mode}`);
      console.error("   Доступные режимы: parse, analyze, funnel, full, refresh-resume, refresh-filters");
      process.exit(1);
    }

    timer.stop("total");
    console.log("🎉 Готово!\n");
    timer.printSummary();
    stats.printSummary();
  } catch (error) {
    console.error(`\n❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  }
}

main();
