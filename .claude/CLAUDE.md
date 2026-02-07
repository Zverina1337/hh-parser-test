# CLAUDE.md — Документация проекта HH-Parser

Этот файл содержит полное описание проекта для AI-ассистентов.

---

## Обзор проекта

**HH-Parser** — CLI-утилита для автоматизации поиска работы на hh.ru с AI-анализом вакансий.

### Основная идея
1. Парсим вакансии с hh.ru на основе резюме пользователя
2. Фильтруем неподходящие вакансии на нескольких этапах (воронка)
3. Глубоко анализируем топовые вакансии через LLM
4. Генерируем персонализированные сопроводительные письма
5. Создаём отчёты для принятия решений

### Стек технологий
- **Runtime:** Node.js (ESM modules)
- **LLM:** Groq API (llama-3.x, llama-4)
- **Парсинг:** axios + cheerio
- **Хранение:** JSON-файлы (без БД)

---

## Архитектура

### Трехэтапная воронка обработки

```
┌─────────────────────────────────────────────────────────────────┐
│  ЭТАП 1: ПАРСИНГ                                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ hh.ru    │───▶│ PreFilter│───▶│ Парсинг  │───▶│ JSON     │  │
│  │ API      │    │ (заголов)│    │ страницы │    │ файлы    │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ЭТАП 2: БЫСТРЫЙ СКОРИНГ                                        │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                   │
│  │ Batch    │───▶│ LLM      │───▶│ Скор     │  (1 запрос       │
│  │ запрос   │    │ оценка   │    │ 1-10     │   на все)        │
│  └──────────┘    └──────────┘    └──────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ЭТАП 3: ГЛУБОКИЙ АНАЛИЗ (только топ-N)                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ Анализ   │───▶│ Генерация│───▶│ Создание │───▶│ Отчёты   │  │
│  │ вакансии │    │ письма   │    │ keyFacts │    │ .md      │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Структура файлов

```
hh-parser/
├── src/
│   ├── index.js              # CLI entry point, main()
│   ├── config.js             # Все настройки проекта
│   ├── groq-client.js        # Клиент Groq API + rate limiter
│   ├── parser.js             # Парсинг hh.ru (axios + cheerio)
│   ├── analyzer.js           # LLM-анализ вакансий
│   ├── preFilter.js          # Предварительная фильтрация по заголовкам
│   ├── filters.js            # Генерация фильтров для поиска hh.ru
│   ├── storage.js            # Работа с JSON (вакансии, статусы)
│   ├── report.js             # Генерация markdown-отчётов
│   ├── resume-processor.js   # Обработка резюме через AI
│   ├── resume-cache.js       # Кэширование резюме и preFilter правил
│   ├── keywords-extractor.js # Извлечение стоп-слов из резюме
│   ├── researcher.js         # [ОТКЛЮЧЁН] Исследование компаний
│   ├── timer.js              # Замер времени выполнения
│   ├── stats.js              # Статистика использования API
│   └── utils.js              # Утилиты (delay, normalizeCompanyName)
├── data/
│   ├── processed.json        # Реестр вакансий и их статусов
│   ├── processed-resume.json # Кэш структурированного резюме
│   ├── keywords-cache.json   # Кэш стоп-слов
│   ├── companies.json        # Реестр компаний
│   └── vacancies/            # JSON-файлы вакансий (по id)
├── output/                   # Сгенерированные отчёты (.md)
├── resume.md                 # Резюме пользователя
├── CLAUDE.md                 # Этот файл
├── README.md                 # Документация для пользователей
├── CLOUD.md                  # Планы развития проекта
├── FUNNEL.md                 # Детали воронки обработки
└── .env                      # API ключи (GROQ_API_KEY)
```

---

## Ключевые модули

### `src/index.js` — Entry point
- Парсинг CLI аргументов
- Режимы: `parse`, `funnel`, `full`, `analyze`, `refresh-resume`
- Оркестрация всех этапов воронки
- Graceful shutdown (SIGINT)

### `src/config.js` — Конфигурация
```javascript
{
  paths: { data, vacancies, output, resume },
  delays: { min: 3000, max: 10000 },  // Задержки между запросами к hh.ru
  http: { timeout, userAgent, headers },
  llm: {
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    temperature: 0.7,
    rateLimits: { /* лимиты для каждой модели */ },
    rateLimitThreshold: 0.8  // 80% от лимита — автопауза
  },
  parsing: { defaultLimit: 20, filterAdvertised: true },
  preFilter: { enabled: true, minPreScore: 0 },
  funnel: {
    quickScore: { minScore: 5, descriptionLength: 500 },
    deepAnalysis: { topN: 10, parallelRequests: 3 }
  }
}
```

### `src/groq-client.js` — LLM клиент
- Обёртка над OpenAI SDK для Groq API
- **Rate Limiter:** отслеживает токены/запросы за минуту
- Автоматическая пауза при приближении к лимитам (80%)
- Retry при 429 ошибках

### `src/parser.js` — Парсинг hh.ru
- `fetchPage(url)` — HTTP GET с retry при сетевых ошибках
- `parseSearchPage(html)` — извлечение превью вакансий
- `parseVacancyPage(html)` — парсинг полной страницы вакансии
- `buildSearchUrl(filters, page)` — построение URL с фильтрами
- Детекция капчи и блокировок

### `src/analyzer.js` — AI-анализ
- `quickScore(vacancies)` — batch-скоринг всех вакансий (1-10)
- `deepAnalyze(vacancy)` — глубокий анализ + keyFacts + вопросы
- `generateHumanCoverLetter(keyFacts)` — генерация письма
- `analyzeVacancy()` — старый режим (legacy)

### `src/preFilter.js` — Предфильтрация
- Фильтрация по заголовку **до** парсинга полной страницы
- Blacklist/Whitelist паттерны (regex)
- Скоринг по стеку технологий (myStack vs otherStack)
- Правила генерируются из резюме через AI

### `src/storage.js` — Хранение данных
- `saveVacancy(vacancy)` — сохранение в `data/vacancies/{id}.json`
- `updateStatus(id, status)` — обновление статуса в processed.json
- `loadVacanciesByStatus(status)` — загрузка по статусу
- Кэширование processed.json с TTL

### `src/report.js` — Генерация отчётов
- `saveVacancyReport(vacancy)` — детальный отчёт по вакансии
- `saveCompanyReport(slug, name, research, vacancies)` — отчёт о компании
- `saveSummaryReport(vacancies)` — сводный отчёт

---

## Статусы вакансий

Вакансии проходят через статусы:

```
parsed → quick_scored / ready_for_deep → analyzed → (error)
```

| Статус | Описание |
|--------|----------|
| `parsed` | Вакансия спарсена, ожидает скоринга |
| `quick_scored` | Низкий скор (<minScore), не идёт на глубокий анализ |
| `ready_for_deep` | Высокий скор (≥minScore), готова к глубокому анализу |
| `analyzed` | Полностью обработана |
| `error` | Ошибка при обработке |

---

## Лимиты Groq API (Free Tier)

| Модель | TPM | TPD | RPM | RPD |
|--------|-----|-----|-----|-----|
| llama-4-scout-17b | 30,000 | 500,000 | 30 | 1,000 |
| llama-3.3-70b-versatile | 12,000 | 100,000 | 30 | 1,000 |
| llama-3.1-8b-instant | 6,000 | 500,000 | 30 | 14,400 |
| qwen3-32b | 6,000 | 500,000 | 60 | 1,000 |

**Важно:** Лимиты считаются **отдельно для каждой модели**.

---

## Команды запуска

```bash
# Полный цикл
npm run full -- --limit 25

# Только парсинг
npm run parse -- --limit 30

# Только воронка (этапы 2-3)
npm run funnel -- --min-score 6 --top-n 15

# Переобработка резюме
npm run refresh-resume

# Переобработка фильтров
npm run refresh-filters
```

---

## Флаги CLI

| Флаг | Описание | По умолчанию |
|------|----------|--------------|
| `--mode` | Режим работы | `full` |
| `--query` | Поисковый запрос (если --no-filters) | — |
| `--limit` | Количество вакансий | 20 |
| `--no-filters` | Без автогенерации фильтров | false |
| `--min-score` | Мин. скор для глубокого анализа | 5 |
| `--top-n` | Кол-во вакансий для глубокого анализа | 10 |
| `--parallel` | Параллельные запросы к LLM | 3 |
| `--refresh-resume` | Принудительная переобработка резюме | — |
| `--refresh-filters` | Принудительная переобработка фильтров | — |

---

## Отключённые модули

### `src/researcher.js` — Исследование компаний
**Статус:** Временно отключён

**Причина:** DuckDuckGo начинает возвращать timeout после ~100 запросов, качество данных низкое (только сниппеты).

**Планы:** См. CLOUD.md — планируется парсинг конкретных сайтов (dreamjob, habr).

---

## Переменные окружения

```env
GROQ_API_KEY=gsk_...          # Обязательно
GROQ_MODEL=llama-4-scout...   # Опционально
GROQ_TEMPERATURE=0.7          # Опционально
```

---

## Важные заметки для разработки

1. **ESM modules** — используем `import/export`, не `require`
2. **Без TypeScript** — чистый JavaScript
3. **Без БД** — всё хранится в JSON-файлах
4. **Rate limiting** — встроен в groq-client.js
5. **Retry logic** — есть для HTTP и LLM запросов
6. **Graceful shutdown** — сохраняет состояние при Ctrl+C

---

## Связанные файлы

- [README.md](README.md) — документация для пользователей
- [FUNNEL.md](FUNNEL.md) — детальное описание трёхэтапной воронки обработки
- [ROADMAP.md](ROADMAP.md) — планы развития проекта (статусы вакансий, новые фичи)
