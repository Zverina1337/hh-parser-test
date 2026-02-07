/**
 * Модуль для отслеживания времени выполнения операций
 */

class Timer {
  constructor() {
    this.timers = new Map();
    this.results = new Map();
  }

  /**
   * Запускает таймер для операции
   * @param {string} name - Название операции
   */
  start(name) {
    this.timers.set(name, Date.now());
  }

  /**
   * Останавливает таймер и возвращает время в секундах
   * @param {string} name - Название операции
   * @returns {number} Время выполнения в секундах
   */
  stop(name) {
    const startTime = this.timers.get(name);
    if (!startTime) {
      console.warn(`⚠️  Таймер "${name}" не был запущен`);
      return 0;
    }

    // Защита от отрицательных значений (системные часы, NTP синхронизация)
    const elapsed = Math.max(0, (Date.now() - startTime) / 1000);
    this.timers.delete(name);

    // Сохраняем результат
    if (!this.results.has(name)) {
      this.results.set(name, []);
    }
    this.results.get(name).push(elapsed);

    return elapsed;
  }

  /**
   * Добавляет время вручную в категорию (для агрегации)
   * @param {string} category - Категория (например, "parse")
   * @param {number} seconds - Время в секундах
   */
  addTime(category, seconds) {
    if (!this.results.has(category)) {
      this.results.set(category, []);
    }
    this.results.get(category).push(seconds);
  }

  /**
   * Форматирует время в читаемый вид
   * @param {number} seconds - Время в секундах
   * @returns {string} Отформатированное время
   */
  format(seconds) {
    if (seconds < 1) {
      return `${(seconds * 1000).toFixed(0)}мс`;
    } else if (seconds < 60) {
      return `${seconds.toFixed(2)}с`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const secs = (seconds % 60).toFixed(0);
      return `${minutes}м ${secs}с`;
    }
  }

  /**
   * Получает все результаты замеров
   * @returns {Map} Карта с результатами
   */
  getResults() {
    return this.results;
  }

  /**
   * Получает среднее время для операции
   * @param {string} name - Название операции
   * @returns {number} Среднее время в секундах
   */
  getAverage(name) {
    const times = this.results.get(name);
    if (!times || times.length === 0) return 0;

    const sum = times.reduce((acc, time) => acc + time, 0);
    return sum / times.length;
  }

  /**
   * Получает общее время для операции
   * @param {string} name - Название операции
   * @returns {number} Общее время в секундах
   */
  getTotal(name) {
    const times = this.results.get(name);
    if (!times || times.length === 0) return 0;

    return times.reduce((acc, time) => acc + time, 0);
  }

  /**
   * Выводит статистику по всем операциям
   */
  printSummary() {
    console.log("\n" + "=".repeat(60));
    console.log("📊 СТАТИСТИКА ВРЕМЕНИ ВЫПОЛНЕНИЯ");
    console.log("=".repeat(60));

    const operations = [
      { key: "search", label: "Поиск вакансий" },
      { key: "parse", label: "Парсинг вакансий" },
      { key: "analyze", label: "Анализ вакансий" },
      { key: "report", label: "Генерация отчётов" },
      { key: "total", label: "ОБЩЕЕ ВРЕМЯ" }
    ];

    operations.forEach(({ key, label }) => {
      const times = this.results.get(key);
      if (!times || times.length === 0) return;

      const total = this.getTotal(key);
      const avg = this.getAverage(key);
      const count = times.length;

      if (key === "total") {
        console.log("\n" + "-".repeat(60));
        console.log(`⏱️  ${label}: ${this.format(total)}`);
      } else {
        console.log(`\n${label}:`);
        console.log(`  • Всего: ${this.format(total)}`);
        if (count > 1) {
          console.log(`  • Среднее: ${this.format(avg)} (${count} операций)`);
        }
      }
    });

    console.log("=".repeat(60) + "\n");
  }

  /**
   * Очищает все результаты
   */
  reset() {
    this.timers.clear();
    this.results.clear();
  }
}

// Глобальный экземпляр таймера
const timer = new Timer();

export default timer;
