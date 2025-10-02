// apps/web/src/lib/rebecca/tools/file-loader.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { promisify } from "util";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import simpleGit from "simple-git";
import { MemoryManager } from "../memory-manager";
import type { Tool } from "../types";
import { globalToolRegistry } from "./registry";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * File Loader Tools - работа с файлами (GitHub, PDF, DOCX)
 */

// ========== LOAD FILE TOOL ==========

export const loadFileTool: Tool = {
  name: "load_file",
  description: "Load and process a file (PDF or DOCX), extract text, chunk it, and save to semantic memory",
  parameters: [
    {
      name: "file_path",
      type: "string",
      description: "Path to the file to load",
      required: true,
    },
    {
      name: "chunk_size",
      type: "number",
      description: "Size of text chunks in characters",
      required: false,
      default: 1000,
    },
    {
      name: "overlap",
      type: "number",
      description: "Overlap between chunks in characters",
      required: false,
      default: 200,
    },
  ],
  returns: "Summary of loaded chunks and saved knowledge IDs",
};

async function loadFileHandler(params: Record<string, any>) {
  const filePath = params.file_path;
  const chunkSize = params.chunk_size || 1000;
  const overlap = params.overlap || 200;

  // Определяем тип файла по расширению
  const ext = path.extname(filePath).toLowerCase();

  let text = "";

  try {
    if (ext === ".pdf") {
      // Загрузка PDF
      const dataBuffer = await readFile(filePath);
      const data = await pdf(dataBuffer);
      text = data.text;
    } else if (ext === ".docx") {
      // Загрузка DOCX
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else {
      throw new Error(`Unsupported file type: ${ext}. Supported: .pdf, .docx`);
    }

    // Разбиваем на чанки
    const chunks = chunkText(text, chunkSize, overlap);

    // Сохраняем каждый чанк в semantic memory
    const memory = new MemoryManager();
    const ids: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = await memory.saveKnowledge({
        kind: "knowledge",
        content: chunk,
        confidence: 0.8,
        source: "provided",
        metadata: {
          source_file: path.basename(filePath),
          chunk_index: i,
          total_chunks: chunks.length,
        },
      });
      ids.push(id);
    }

    return {
      success: true,
      file: path.basename(filePath),
      chunks_count: chunks.length,
      total_characters: text.length,
      saved_ids: ids,
    };
  } catch (error: any) {
    throw new Error(`Failed to load file: ${error.message}`);
  }
}

// ========== LOAD GITHUB REPO TOOL ==========

export const loadGithubRepoTool: Tool = {
  name: "load_github_repo",
  description: "Clone a GitHub repository, extract text from files, and save to semantic memory",
  parameters: [
    {
      name: "repo_url",
      type: "string",
      description: "GitHub repository URL (e.g., https://github.com/user/repo)",
      required: true,
    },
    {
      name: "file_patterns",
      type: "array",
      description: "Array of file patterns to include (e.g., ['*.md', '*.txt', '*.py'])",
      required: false,
      default: ["*.md", "*.txt"],
    },
    {
      name: "chunk_size",
      type: "number",
      description: "Size of text chunks in characters",
      required: false,
      default: 1500,
    },
  ],
  returns: "Summary of cloned repository and saved chunks",
};

async function loadGithubRepoHandler(params: Record<string, any>) {
  const repoUrl = params.repo_url;
  const filePatterns = params.file_patterns || ["*.md", "*.txt"];
  const chunkSize = params.chunk_size || 1500;

  // Создаём временную директорию для клонирования
  const tmpDir = path.join(os.tmpdir(), `rebecca-repo-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    // Клонируем репозиторий
    const git = simpleGit();
    await git.clone(repoUrl, tmpDir, ["--depth", "1"]); // shallow clone

    // Находим файлы по паттернам
    const files = await findFilesByPatterns(tmpDir, filePatterns);

    if (files.length === 0) {
      return {
        success: false,
        message: "No files found matching the patterns",
        patterns: filePatterns,
      };
    }

    // Читаем и обрабатываем файлы
    const memory = new MemoryManager();
    const allIds: string[] = [];
    let totalChunks = 0;

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const relativePath = path.relative(tmpDir, file);

      // Разбиваем на чанки
      const chunks = chunkText(content, chunkSize, 200);

      // Сохраняем каждый чанк
      for (let i = 0; i < chunks.length; i++) {
        const id = await memory.saveKnowledge({
          kind: "knowledge",
          content: chunks[i],
          confidence: 0.8,
          source: "provided",
          metadata: {
            source_repo: repoUrl,
            source_file: relativePath,
            chunk_index: i,
            total_chunks: chunks.length,
          },
        });
        allIds.push(id);
        totalChunks++;
      }
    }

    return {
      success: true,
      repo_url: repoUrl,
      files_processed: files.length,
      total_chunks: totalChunks,
      saved_ids: allIds,
    };
  } catch (error: any) {
    throw new Error(`Failed to load GitHub repo: ${error.message}`);
  } finally {
    // Очистка временной директории
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Разбить текст на чанки с перекрытием
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }

  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Найти файлы по паттернам (простая версия с glob-like matching)
 */
async function findFilesByPatterns(dir: string, patterns: string[]): Promise<string[]> {
  const results: string[] = [];

  function walkDir(currentDir: string) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Пропускаем .git и node_modules
        if (item === ".git" || item === "node_modules") {
          continue;
        }
        walkDir(fullPath);
      } else if (stat.isFile()) {
        // Проверяем соответствие паттернам
        const matches = patterns.some((pattern) => {
          const ext = pattern.replace("*", "");
          return fullPath.endsWith(ext);
        });

        if (matches) {
          results.push(fullPath);
        }
      }
    }
  }

  walkDir(dir);
  return results;
}

// ========== РЕГИСТРАЦИЯ ИНСТРУМЕНТОВ ==========

export function registerFileLoaderTools() {
  globalToolRegistry.register(loadFileTool, loadFileHandler);
  globalToolRegistry.register(loadGithubRepoTool, loadGithubRepoHandler);
}
