#!/usr/bin/env node
/**
 * Миграция БД для Rebecca Memory System
 * Создаёт 5 таблиц для трёх видов памяти + tool_executions + reflections
 * 
 * Использование:
 *   node scripts/migrate-rebecca-memory.js
 * 
 * Требует переменную окружения DATABASE_URL
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function migrate() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error("❌ DATABASE_URL не установлен!");
    process.exit(1);
  }

  console.log("🚀 Начинаем миграцию Rebecca Memory System...\n");

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Проверяем наличие расширения pgvector
    console.log("📦 Проверяем расширение pgvector...");
    const vectorCheck = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')"
    );
    
    if (!vectorCheck.rows[0].exists) {
      console.log("⚠️  pgvector не установлен, пытаемся установить...");
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      console.log("✅ pgvector установлен");
    } else {
      console.log("✅ pgvector уже установлен");
    }

    // Читаем SQL схему
    const schemaPath = path.join(__dirname, "../apps/web/src/lib/rebecca/schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");

    console.log("\n📝 Применяем SQL миграцию...");

    // Разбиваем на отдельные команды и выполняем
    const statements = schemaSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (err) {
        // Игнорируем ошибки если таблица уже существует
        if (!err.message.includes("already exists")) {
          throw err;
        }
      }
    }

    console.log("✅ SQL миграция применена");

    // Проверяем созданные таблицы
    console.log("\n🔍 Проверяем созданные таблицы...");
    const tables = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename IN ('episodic_memory', 'semantic_memory', 'tool_executions', 'reflections', 'agent_sessions')
      ORDER BY tablename
    `);

    console.log(`✅ Найдено таблиц: ${tables.rows.length}/5`);
    tables.rows.forEach((row) => {
      console.log(`   - ${row.tablename}`);
    });

    // Проверяем индексы
    console.log("\n🔍 Проверяем индексы...");
    const indexes = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND tablename IN ('episodic_memory', 'semantic_memory')
        AND indexname LIKE '%embedding%'
      ORDER BY indexname
    `);

    console.log(`✅ Найдено vector индексов: ${indexes.rows.length}`);
    indexes.rows.forEach((row) => {
      console.log(`   - ${row.indexname}`);
    });

    // Тестовая запись в semantic_memory
    console.log("\n🧪 Тестовая запись...");
    const testEmbedding = Array(1536).fill(0).map(() => Math.random() * 0.1);
    
    await pool.query(
      `INSERT INTO semantic_memory 
       (namespace, kind, content, confidence, source, embedding)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        "rebecca",
        "knowledge",
        "Test knowledge: Rebecca memory system is working",
        0.9,
        "provided",
        `[${testEmbedding.join(",")}]`,
      ]
    );

    const count = await pool.query(
      "SELECT COUNT(*) as count FROM semantic_memory WHERE namespace = 'rebecca'"
    );

    console.log(`✅ Записей в semantic_memory: ${count.rows[0].count}`);

    console.log("\n✨ Миграция успешно завершена!\n");

  } catch (error) {
    console.error("\n❌ Ошибка миграции:", error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
