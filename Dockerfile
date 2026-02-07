# Используем Node.js Alpine для минимального размера образа
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY src/ ./src/

# Создаём директории для данных
RUN mkdir -p data output

# Запуск по умолчанию — полный цикл
CMD ["node", "src/index.js", "--mode", "full"]
