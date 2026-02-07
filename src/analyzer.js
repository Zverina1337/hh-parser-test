import { loadProcessedResume, loadContacts } from "./resume-cache.js";
import { groq, MODEL, TEMPERATURE } from "./groq-client.js";

// Загрузка обработанного резюме (используется кэш если доступен)
async function loadResume() {
  try {
    const processedResume = await loadProcessedResume();
    // Преобразуем структурированное резюме в текстовый формат для промптов
    return formatResumeForPrompt(processedResume);
  } catch (error) {
    console.warn("⚠️  Не удалось загрузить резюме:", error.message);
    return "Резюме не предоставлено";
  }
}

// Форматирует структурированное резюме в текст для промптов
function formatResumeForPrompt(structured) {
  return `
**Технические навыки:** ${structured.skills.technical.join(", ")}
**Софт-скиллы:** ${structured.skills.soft.join(", ")}
**Опыт работы:** ${structured.experience.years} лет
**Ключевые достижения:**
${structured.experience.highlights.map(h => `- ${h}`).join("\n")}
**Образование:** ${structured.education}
**Предпочтения:**
- Формат работы: ${structured.preferences.workFormat}
- Зарплата: ${structured.preferences.salary || "не указана"}
- Интересы: ${structured.preferences.interests.join(", ")}

**Краткое описание:** ${structured.summary}
  `.trim();
}

// Анализ вакансии через LLM
export async function analyzeVacancy(vacancy, resume = null) {
  if (!resume) {
    resume = await loadResume();
  }

  const prompt = `Ты эксперт по карьерному консультированию. Проанализируй вакансию и оцени, насколько она подходит кандидату.

## Резюме кандидата:
${resume}

## Вакансия:
Должность: ${vacancy.title}
Компания: ${vacancy.company}
Зарплата: ${vacancy.salary}
Опыт: ${vacancy.experience}
URL: ${vacancy.url}

Описание:
${vacancy.description}

## Задача:
1. Оцени соответствие вакансии и резюме от 0 до 100
2. Перечисли 2-3 главных плюса этой вакансии для кандидата
3. Перечисли 2-3 минуса или потенциальные проблемы
4. Дай краткое резюме (1-2 предложения): стоит ли кандидату откликаться?

ВАЖНО: Отвечай ТОЛЬКО на русском языке!

Ответ в формате JSON:
{
  "matchScore": 85,
  "pros": ["плюс 1", "плюс 2"],
  "cons": ["минус 1", "минус 2"],
  "summary": "Краткое резюме на русском"
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: TEMPERATURE,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    if (error.status === 429) {
      throw new Error("Превышен лимит запросов к Groq API. Попробуйте позже.");
    }
    throw error;
  }
}

// Форматирует контакты для подписи письма
async function formatContactsSignature(contacts, signatureConfig = null) {
  if (!contacts) {
    return "";
  }

  // Загружаем настройки подписи из конфига или используем дефолтные
  const { default: config } = await import("./config.js");
  const settings = signatureConfig || config.signature || {
    enabledContacts: ["telegram"],
    showName: false
  };

  // Метки для контактов
  const contactLabels = {
    telegram: "Telegram",
    email: "Email",
    phone: "Телефон",
    github: "GitHub",
    linkedin: "LinkedIn",
    vk: "ВКонтакте",
    whatsapp: "WhatsApp"
  };

  // Собираем только включённые контакты
  const contactLines = [];
  for (const key of settings.enabledContacts) {
    if (contacts[key]) {
      contactLines.push(`${contactLabels[key]}: ${contacts[key]}`);
    }
  }

  // Если нет контактов для отображения, возвращаем пустую строку
  if (contactLines.length === 0 && !settings.showName) {
    return "";
  }

  let signature = "\n\n";

  // Добавляем имя только если включено в настройках
  if (settings.showName && contacts.name) {
    signature += `${contacts.name}\n`;
  }

  // Добавляем контакты
  if (contactLines.length > 0) {
    signature += contactLines.join("\n") + "\n";
  }

  return signature;
}

// Генерация сопроводительного письма с учётом информации о компании
// DEPRECATED: используйте generateHumanCoverLetter() для лучшего качества
export async function generateCoverLetter(vacancy, resume = null, companyResearch = null) {
  if (!resume) {
    resume = await loadResume();
  }

  // Формируем информацию о компании для промпта
  let companyContext = "";
  if (companyResearch && companyResearch.status === "success" && companyResearch.analysis) {
    const analysis = companyResearch.analysis;
    companyContext = `

**Информация о компании из исследования:**
${analysis.overview.description}

Позитивные аспекты компании:
${analysis.positives.slice(0, 3).map(p => `- ${p}`).join('\n')}

Используй эту информацию, чтобы показать знание о компании и объяснить, почему хочешь работать именно здесь.
`;
  }

  const prompt = `Ты эксперт по написанию сопроводительных писем. Напиши персонализированное сопроводительное письмо для этой вакансии.

## Резюме кандидата:
${resume}

## Вакансия:
Должность: ${vacancy.title}
Компания: ${vacancy.company}
URL: ${vacancy.url}
${companyContext}

Описание:
${vacancy.description}

## Требования:
1. Письмо должно быть профессиональным, но живым
2. Длина: 150-200 слов
3. Подчеркни релевантный опыт и навыки
4. Покажи искренний интерес к компании и позиции (используй информацию о компании, если есть)
5. Избегай шаблонных фраз

ВАЖНО: Пиши ТОЛЬКО на русском языке!

Напиши только текст письма, без темы и подписи.`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: TEMPERATURE
    });

    const letterText = completion.choices[0].message.content.trim();

    // Загружаем контакты и добавляем их в конец письма
    const contacts = await loadContacts();
    const signature = await formatContactsSignature(contacts);

    return letterText + signature;
  } catch (error) {
    if (error.status === 429) {
      throw new Error("Превышен лимит запросов к Groq API. Попробуйте позже.");
    }
    throw error;
  }
}


// Генерация сопроводительного письма с минимальным контекстом (человеческий стиль)
export async function generateHumanCoverLetter(keyFacts, candidateInfo = null) {
  if (!candidateInfo) {
    // Загружаем минимум информации о кандидате
    const processedResume = await loadProcessedResume();
    candidateInfo = {
      name: processedResume.contacts?.name || "Кандидат",
      mainSkills: processedResume.skills.technical.slice(0, 4),
      experience: processedResume.experience.years,
      highlight: processedResume.experience.highlights[0] || ""
    };
  }

  const prompt = `Напиши сопроводительное письмо так, как написал бы живой человек.

## Кто пишет:
- Имя: ${candidateInfo.name}
- Опыт: ${candidateInfo.experience} лет
- Ключевые навыки: ${candidateInfo.mainSkills.join(", ")}
- Главное достижение: ${candidateInfo.highlight}

## Куда откликается:
- Позиция: ${keyFacts.position}
- Компания: ${keyFacts.company}
${keyFacts.companyFact ? `- О компании: ${keyFacts.companyFact}` : ""}
- Им нужно: ${keyFacts.keyRequirements.join(", ")}
${keyFacts.uniqueAspect ? `- Что привлекает: ${keyFacts.uniqueAspect}` : ""}

## КРИТИЧНО — письмо должно звучать как от живого человека:

1. ЗАПРЕЩЁННЫЕ фразы:
   - "Пишу вам, чтобы выразить интерес...", "Меня заинтересовала ваша вакансия..."
   - "Уверен, что мой опыт...", "Я идеально подхожу..."
   - Любые шаблонные фразы из типичных сопроводительных писем
   - Превосходные степени без конкретики ("отличный", "выдающийся", "уникальный")

2. ОБЯЗАТЕЛЬНО:
   - Начни с конкретики: почему именно эта вакансия/компания
   - Пиши просто, как сообщение знакомому (но профессионально)
   - Приведи 1-2 конкретных примера релевантного опыта
   - Покажи понимание того, чем занимается компания
   - Закончи естественно, без пафоса

3. ФОРМАТ:
   - 100-150 слов (не больше!)
   - 2-3 коротких абзаца
   - Без приветствия ("Здравствуйте" и т.д.)
   - Без подписи (она добавится автоматически)

## Пример хорошего начала:
"Увидел вакансию Vue-разработчика и сразу понял — это моё. Последние 2 года работаю именно с Vue 3 и TypeScript..."

Напиши письмо:`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8  // Чуть выше для естественности
    });

    const letterText = completion.choices[0].message.content.trim();

    // Загружаем контакты и добавляем подпись
    const contacts = await loadContacts();
    const signature = await formatContactsSignature(contacts);

    return letterText + signature;
  } catch (error) {
    if (error.status === 429) {
      throw new Error("Превышен лимит запросов к Groq API. Попробуйте позже.");
    }
    throw error;
  }
}

// Retry logic с экспоненциальной задержкой
export async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      if (error.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        console.log(`⏳ Rate limit. Повтор через ${delay / 1000}с...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// Этап 2: Быстрый скоринг вакансий (batch-запрос)
export async function quickScore(vacancies, resume = null, descriptionLength = 500) {
  if (!resume) {
    resume = await loadResume();
  }

  // Подготавливаем сокращенные данные для каждой вакансии
  const shortVacancies = vacancies.map(v => ({
    id: v.id,
    title: v.title,
    company: v.company,
    salary: v.salary,
    experience: v.experience,
    description: v.description.substring(0, descriptionLength)
  }));

  const prompt = `Ты эксперт по рекрутингу. Быстро оцени, насколько вакансии подходят кандидату.

## Резюме кандидата:
${resume}

## Вакансии для оценки:
${JSON.stringify(shortVacancies, null, 2)}

## Задача:
Для КАЖДОЙ вакансии дай быструю оценку от 1 до 10:
- 1-3: Не подходит (другой стек, неподходящие условия)
- 4-6: Средняя релевантность (частичное совпадение)
- 7-10: Высокая релевантность (хорошее совпадение)

## ВАЖНО:
- Оценивай СТРОГО по совпадению навыков и опыта
- Если вакансия требует технологии, которых нет в резюме — низкий скор
- Если вакансия идеально подходит под профиль — высокий скор

Ответ в формате JSON (массив объектов):
[
  {"id": "129609492", "score": 8, "reason": "Отличное совпадение: Vue.js, TypeScript, удалёнка"},
  {"id": "129312176", "score": 3, "reason": "Требуется Python, кандидат JavaScript-разработчик"}
]`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;

    console.log("  📝 Сырой ответ от LLM:", content.substring(0, 500));

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON:", parseError.message);
      console.error("❌ Содержимое ответа:", content);
      throw new Error(`Невалидный JSON от LLM: ${parseError.message}`);
    }

    let scores;

    if (Array.isArray(parsed)) {
      scores = parsed;
    } else if (parsed.scores && Array.isArray(parsed.scores)) {
      scores = parsed.scores;
    } else if (parsed.results && Array.isArray(parsed.results)) {
      scores = parsed.results;
    } else if (parsed.vacancies && Array.isArray(parsed.vacancies)) {
      scores = parsed.vacancies;
    } else {
      // Ищем любое поле с массивом
      const arrayField = Object.keys(parsed).find(key => Array.isArray(parsed[key]));
      if (arrayField) {
        console.log(`  ✅ Найден массив в поле: "${arrayField}"`);
        scores = parsed[arrayField];
      } else {
        // Проверяем формат {id: {score, reason}, ...} — объект с ID в качестве ключей
        const keys = Object.keys(parsed);
        const firstValue = parsed[keys[0]];
        if (keys.length > 0 && typeof firstValue === "object" && firstValue !== null && "score" in firstValue) {
          console.log(`  ✅ Обнаружен формат объекта с ID-ключами (${keys.length} записей)`);
          scores = keys.map(id => ({
            id,
            score: firstValue.score !== undefined ? parsed[id].score : parsed[id].rating,
            reason: parsed[id].reason || parsed[id].comment || parsed[id].description || ""
          }));
        } else {
          console.error("❌ Структура ответа LLM:", JSON.stringify(parsed, null, 2).substring(0, 1000));
          console.error("❌ Ключи в ответе:", keys);
          console.error("❌ Типы значений:", Object.entries(parsed).map(([k, v]) => `${k}: ${typeof v}`).join(", "));
          throw new Error("Не найден массив с оценками в ответе LLM");
        }
      }
    }

    // Проверяем, что получили массив
    if (!Array.isArray(scores)) {
      console.error("❌ scores не является массивом:", typeof scores);
      throw new Error("Неожиданный формат ответа от LLM");
    }

    return scores;
  } catch (error) {
    if (error.status === 429) {
      throw new Error("Превышен лимит запросов к Groq API. Попробуйте позже.");
    }
    throw error;
  }
}

// Этап 3: Комплексный глубокий анализ вакансии (объединённый запрос)
// Включает: анализ вакансии + вопросы для собеседования + ключевые факты для письма
export async function deepAnalyze(vacancy, resume = null, companyResearch = null) {
  if (!resume) {
    resume = await loadResume();
  }

  // Формируем информацию о компании для промпта (если есть)
  let companyInfo = "";
  if (companyResearch && companyResearch.status === "success" && companyResearch.analysis) {
    const analysis = companyResearch.analysis;
    companyInfo = `

## Данные исследования компании:
- Описание: ${analysis.overview.description}
- Отрасль: ${analysis.overview.industry}
- Оценка надёжности: ${analysis.reliabilityScore}/10
- Резюме: ${analysis.reliabilitySummary}

Позитивные сигналы:
${analysis.positives.map(p => `- ${p}`).join('\n')}

Красные флаги:
${analysis.redFlags.length > 0 ? analysis.redFlags.map(r => `- ${r}`).join('\n') : '- Не обнаружено'}
`;
  } else if (companyResearch && companyResearch.status === "insufficient_data") {
    companyInfo = `

## Данные исследования компании:
Недостаточно публичной информации о компании.
`;
  }

  const prompt = `Ты эксперт по карьерному консультированию. Проведи комплексный анализ вакансии для кандидата.

## Резюме кандидата:
${resume}

## Вакансия:
Должность: ${vacancy.title}
Компания: ${vacancy.company}
Зарплата: ${vacancy.salary}
Требуемый опыт: ${vacancy.experience}
URL: ${vacancy.url}
${companyInfo}

Полное описание:
${vacancy.description}

## Твоя задача:
Проанализируй вакансию и предоставь ТРИ вещи в одном JSON-ответе:

1. **Глубокий анализ** — Оцени, насколько вакансия подходит кандидату
2. **Вопросы для собеседования** — Сгенерируй 3-5 конкретных вопросов, которые кандидат должен задать
3. **Ключевые факты для письма** — Извлеки важные факты для написания персонализированного сопроводительного письма

ВАЖНО: ВСЕ тексты должны быть на РУССКОМ языке!

Формат ответа (только JSON):
{
  "analysis": {
    "matchScore": 85,
    "pros": ["плюс 1", "плюс 2", "плюс 3"],
    "cons": ["минус 1", "минус 2"],
    "summary": "Подробное резюме на 2-3 предложения: стоит ли откликаться и почему",
    "offerProbability": "high"
  },
  "interviewQuestions": [
    "Конкретный вопрос о структуре команды?",
    "Вопрос о деталях технического стека?",
    "Вопрос для проверки красных флагов?"
  ],
  "keyFacts": {
    "position": "точное название позиции",
    "company": "название компании",
    "companyFact": "один интересный факт о компании, если есть, или null",
    "keyRequirements": ["требование 1", "требование 2", "требование 3"],
    "uniqueAspect": "что делает эту вакансию особенной (удалёнка, интересный проект, стек и т.д.)"
  }
}

Важно:
- matchScore: 0-100 на основе совпадения навыков/опыта
- offerProbability: "low", "medium" или "high"
- Вопросы для собеседования должны быть конкретными и практичными, не общими
- Если у компании есть красные флаги, включи вопросы для их проверки
- keyFacts должны быть краткими для генерации письма`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: TEMPERATURE,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    const result = JSON.parse(content);

    // Возвращаем структурированный результат
    return {
      vacancyAnalysis: result.analysis,
      companyQuestions: result.interviewQuestions || [],
      keyFacts: result.keyFacts,
      companyResearch
    };
  } catch (error) {
    if (error.status === 429) {
      throw new Error("Превышен лимит запросов к Groq API. Попробуйте позже.");
    }
    throw error;
  }
}


// Параллельная обработка вакансий
export async function processVacanciesInParallel(vacancies, processFn, concurrency = 3) {
  const results = [];
  const errors = [];

  // Разбиваем на батчи по concurrency штук
  for (let i = 0; i < vacancies.length; i += concurrency) {
    const batch = vacancies.slice(i, i + concurrency);

    // Обрабатываем батч параллельно
    const promises = batch.map(async (vacancy) => {
      try {
        const result = await retryWithBackoff(() => processFn(vacancy));
        return { success: true, vacancy, result };
      } catch (error) {
        return { success: false, vacancy, error: error.message };
      }
    });

    const batchResults = await Promise.all(promises);

    // Разделяем успешные и неуспешные результаты
    for (const item of batchResults) {
      if (item.success) {
        results.push({ vacancy: item.vacancy, result: item.result });
      } else {
        errors.push({ vacancy: item.vacancy, error: item.error });
      }
    }

    // Небольшая задержка между батчами
    if (i + concurrency < vacancies.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { results, errors };
}
