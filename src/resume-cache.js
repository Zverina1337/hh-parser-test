import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import config from "./config.js";
import { groq } from "./groq-client.js";

const CACHE_PATH = path.join(config.paths.data, "resume-cache.json");

/**
 * Вычисляет SHA256 хэш для контента
 */
function calculateHash(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Загружает сырое резюме из resume.md
 */
async function loadRawResume() {
  const resumePath = path.join(process.cwd(), "resume.md");

  try {
    return await fs.readFile(resumePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Файл resume.md не найден! Создайте его в корне проекта.");
    }
    throw error;
  }
}

/**
 * Обработка резюме через AI для структурирования
 */
async function processResumeWithAI(rawResume) {
  const prompt = `You are an HR and resume analysis expert. Your task is to structure the candidate's resume into JSON format.

# Source resume:
${rawResume}

# Task:
Analyze the resume and extract information in JSON format:

{
  "summary": "Brief candidate description in 2-3 sentences",
  "skills": {
    "technical": ["list of technical skills"],
    "soft": ["list of soft skills"]
  },
  "experience": {
    "years": number_of_years,
    "highlights": ["key achievements and projects"]
  },
  "education": "education level",
  "preferences": {
    "workFormat": "remote/office/hybrid",
    "salary": "expected salary or null",
    "interests": ["areas of interest"]
  },
  "contacts": {
    "name": "Name",
    "telegram": "@username or null",
    "email": "email@example.com or null",
    "phone": "+7 999 123-45-67 or null",
    "github": "username or null",
    "linkedin": "username or null"
  }
}

# Requirements:
- Be as accurate as possible
- Do not add skills that are not in the resume
- If information is missing, use null
- contacts: include ONLY fields present in resume (name is required)
- Return ONLY JSON, no additional text

JSON:`;

  try {
    const response = await groq.chat.completions.create({
      model: config.llm.model,
      messages: [
        {
          role: "system",
          content: "Ты — эксперт по структурированию резюме. Возвращаешь только валидный JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("AI не вернул валидный JSON");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("❌ Ошибка при обработке резюме через AI:", error.message);
    throw error;
  }
}

/**
 * Извлечение ключевых слов из структурированного резюме
 */
async function extractKeywords(structuredResume) {
  const prompt = `Analyze the resume and extract key data for vacancy filtering.

## Resume:
${JSON.stringify(structuredResume, null, 2)}

## Task:
1. **stopWords** - technologies/languages the candidate does NOT use
2. **requiredSkills** - technologies from main stack
3. **preferredSkills** - familiar technologies

Response in JSON format:
{
  "stopWords": ["Python", "Java", "PHP"],
  "requiredSkills": ["JavaScript", "TypeScript", "React"],
  "preferredSkills": ["Node.js", "PostgreSQL"]
}`;

  try {
    const response = await groq.chat.completions.create({
      model: config.llm.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error("❌ Ошибка при извлечении ключевых слов:", error.message);
    throw error;
  }
}

/**
 * Генерация правил предварительной фильтрации (preFilter)
 */
async function generatePreFilterRules(structuredResume) {
  const prompt = `You are a vacancy filtering expert. Based on the resume, generate rules for pre-filtering vacancies by title.

RESUME:
${JSON.stringify(structuredResume, null, 2)}

Return result in JSON format:
{
  "targetRole": "candidate's target role (e.g.: Frontend Developer)",
  "minRelevanceForFetch": 0.3,
  "titleBlacklist": [
    "regex patterns for titles that definitely DO NOT match"
  ],
  "titleWhitelist": [
    "regex patterns for target roles"
  ],
  "myStack": [
    "candidate's technologies in lowercase"
  ],
  "otherStack": [
    "technologies from other specializations that signal irrelevance"
  ]
}

GENERATION RULES:

1. **titleBlacklist** — strict, only obviously irrelevant roles:
   - Consider spelling variations (backend/back-end/бэкенд/бекенд)
   - Roles from other areas (qa, devops, mobile, data, 1c, analyst, designer)
   - DO NOT include levels (junior/senior) — not a reason for rejection
   - Use regex: "\\\\b(backend|бэкенд|бекенд)\\\\b"

2. **titleWhitelist** — target roles and variations:
   - "\\\\b(frontend|фронтенд|front-end)\\\\b"
   - Specific roles for candidate's stack

3. **myStack** — technologies from resume in lowercase:
   - Main technologies and frameworks
   - Programming languages

4. **otherStack** — technologies signaling different specialization:
   - Languages/frameworks from other areas (python, java, php, c#, go, rust)
   - DO NOT include universal technologies (git, docker, sql)

5. **minRelevanceForFetch** — relevance threshold (0.3 by default)

Return ONLY valid JSON without comments.

JSON:`;

  try {
    const response = await groq.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: "system", content: "Ты эксперт по фильтрации вакансий. Возвращай только валидный JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("LLM не вернул валидный JSON для preFilter");
    }

    const rules = JSON.parse(jsonMatch[0]);

    // Валидация обязательных полей
    if (!rules.titleBlacklist || !Array.isArray(rules.titleBlacklist)) {
      rules.titleBlacklist = [];
    }
    if (!rules.titleWhitelist || !Array.isArray(rules.titleWhitelist)) {
      rules.titleWhitelist = [];
    }
    if (!rules.myStack || !Array.isArray(rules.myStack)) {
      rules.myStack = [];
    }
    if (!rules.otherStack || !Array.isArray(rules.otherStack)) {
      rules.otherStack = [];
    }
    if (typeof rules.minRelevanceForFetch !== "number") {
      rules.minRelevanceForFetch = 0.3;
    }

    return rules;
  } catch (error) {
    console.error("❌ Ошибка при генерации правил preFilter:", error.message);
    throw error;
  }
}

/**
 * Извлечение параметров фильтрации для hh.ru
 */
async function extractFilters(structuredResume) {
  const prompt = `Analyze the resume and extract parameters for job search on hh.ru.

RESUME:
${JSON.stringify(structuredResume, null, 2)}

Return result in JSON format:
{
  "keywords": ["keyword 1", "keyword 2"],
  "experience": "noExperience|between1And3|between3And6|moreThan6",
  "specialization": "frontend|backend|fullstack|mobile|devops|qa|data",
  "schedule": ["remote", "fullDay", "flexible"],
  "employment": ["full", "part"],
  "minSalary": number or null,
  "currency": "RUR|USD|EUR"
}

RULES:
- keywords: up to 10 key technologies
- experience: experience level based on years of work
- schedule: preferred schedule (can be multiple)
- employment: employment type (can be multiple)
- minSalary: minimum salary or null
- Return ONLY valid JSON

JSON:`;

  try {
    const response = await groq.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: "system", content: "Ты эксперт по анализу резюме. Возвращай только валидный JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("LLM не вернул валидный JSON");
    }

    const extracted = JSON.parse(jsonMatch[0]);

    if (!extracted.keywords || !Array.isArray(extracted.keywords)) {
      throw new Error("Некорректная структура данных: отсутствует keywords");
    }

    return extracted;
  } catch (error) {
    console.error("❌ Ошибка при извлечении фильтров:", error.message);
    throw error;
  }
}

/**
 * Загрузка кэшированного резюме
 */
async function loadCache() {
  try {
    const content = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    console.warn("⚠️  Не удалось загрузить кэш резюме:", error.message);
    return null;
  }
}

/**
 * Сохранение кэша резюме
 */
async function saveCache(cacheData) {
  await fs.mkdir(config.paths.data, { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cacheData, null, 2), "utf8");
}

/**
 * Основная функция: загружает или обрабатывает резюме
 * @param {boolean} forceRefresh - принудительная переобработка
 * @returns {Promise<Object>} Полный объект кэша
 */
async function loadResumeCache(forceRefresh = false) {
  const rawResume = await loadRawResume();
  const currentHash = calculateHash(rawResume);

  // Проверяем кэш
  if (!forceRefresh) {
    const cached = await loadCache();

    if (cached && cached.sourceHash === currentHash) {
      console.log("✓ Используется кэшированное резюме");
      return cached;
    }
  }

  // Обрабатываем через AI
  console.log("🔄 Обработка резюме через AI...");
  const structured = await processResumeWithAI(rawResume);

  // Извлечение ключевых слов, фильтров и правил preFilter параллельно
  console.log("🔄 Извлечение ключевых слов, фильтров и правил preFilter...");
  const [keywords, filters, preFilterRules] = await Promise.all([
    extractKeywords(structured),
    extractFilters(structured),
    generatePreFilterRules(structured)
  ]);

  // Собираем полный объект кэша
  const cacheData = {
    cachedAt: new Date().toISOString(),
    sourceHash: currentHash,
    summary: structured.summary,
    skills: structured.skills,
    experience: structured.experience,
    education: structured.education,
    preferences: structured.preferences,
    contacts: structured.contacts,
    keywords: keywords,
    filters: filters,
    preFilterRules: preFilterRules
  };

  await saveCache(cacheData);
  console.log("✓ Резюме обработано и сохранено в кэш");

  return cacheData;
}

/**
 * Получить только структурированное резюме (для обратной совместимости)
 */
async function loadProcessedResume(forceRefresh = false) {
  const cache = await loadResumeCache(forceRefresh);
  return {
    summary: cache.summary,
    skills: cache.skills,
    experience: cache.experience,
    education: cache.education,
    preferences: cache.preferences,
    contacts: cache.contacts
  };
}

/**
 * Получить только ключевые слова (для обратной совместимости)
 */
async function loadKeywords(forceRefresh = false) {
  const cache = await loadResumeCache(forceRefresh);
  return cache.keywords;
}

/**
 * Получить только фильтры (для обратной совместимости)
 */
async function loadFilters(forceRefresh = false) {
  const cache = await loadResumeCache(forceRefresh);
  return cache.filters;
}

/**
 * Получить только контакты
 */
async function loadContacts(forceRefresh = false) {
  const cache = await loadResumeCache(forceRefresh);
  return cache.contacts;
}

/**
 * Получить правила preFilter
 */
async function loadPreFilterRules(forceRefresh = false) {
  const cache = await loadResumeCache(forceRefresh);
  return cache.preFilterRules;
}

export {
  loadResumeCache,
  loadProcessedResume,
  loadKeywords,
  loadFilters,
  loadContacts,
  loadPreFilterRules,
  loadRawResume,
  calculateHash
};
