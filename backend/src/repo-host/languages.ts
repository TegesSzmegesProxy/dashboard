import { posix } from 'node:path';

/**
 * Extension → language. Languages with a bundled tree-sitter grammar get
 * tier 1 (symbols, definitions); every other text file is still tier 0
 * (listing, reading, search) so analysis works for any language (ADR-0013).
 */
interface LanguageSpec {
  language: string;
  /** File name in `tree-sitter-wasms/out/` without `tree-sitter-` and `.wasm`. */
  grammar: string | null;
}

const BY_EXTENSION: Record<string, LanguageSpec> = {
  '.js': { language: 'javascript', grammar: 'javascript' },
  '.mjs': { language: 'javascript', grammar: 'javascript' },
  '.cjs': { language: 'javascript', grammar: 'javascript' },
  '.jsx': { language: 'javascript', grammar: 'javascript' },
  '.ts': { language: 'typescript', grammar: 'typescript' },
  '.mts': { language: 'typescript', grammar: 'typescript' },
  '.cts': { language: 'typescript', grammar: 'typescript' },
  '.tsx': { language: 'typescript', grammar: 'tsx' },
  '.py': { language: 'python', grammar: 'python' },
  '.php': { language: 'php', grammar: 'php' },
  '.java': { language: 'java', grammar: 'java' },
  '.kt': { language: 'kotlin', grammar: 'kotlin' },
  '.kts': { language: 'kotlin', grammar: 'kotlin' },
  '.scala': { language: 'scala', grammar: 'scala' },
  '.go': { language: 'go', grammar: 'go' },
  '.rb': { language: 'ruby', grammar: 'ruby' },
  '.rake': { language: 'ruby', grammar: 'ruby' },
  '.cs': { language: 'csharp', grammar: 'c_sharp' },
  '.rs': { language: 'rust', grammar: 'rust' },
  '.swift': { language: 'swift', grammar: 'swift' },
  '.ex': { language: 'elixir', grammar: 'elixir' },
  '.exs': { language: 'elixir', grammar: 'elixir' },
  '.dart': { language: 'dart', grammar: 'dart' },
  '.lua': { language: 'lua', grammar: 'lua' },
  '.c': { language: 'c', grammar: 'c' },
  '.h': { language: 'c', grammar: 'c' },
  '.cc': { language: 'cpp', grammar: 'cpp' },
  '.cpp': { language: 'cpp', grammar: 'cpp' },
  '.hpp': { language: 'cpp', grammar: 'cpp' },
  '.zig': { language: 'zig', grammar: 'zig' },
  '.ml': { language: 'ocaml', grammar: 'ocaml' },
  '.vue': { language: 'vue', grammar: null },
  '.svelte': { language: 'svelte', grammar: null },
  '.erl': { language: 'erlang', grammar: null },
  '.hrl': { language: 'erlang', grammar: null },
  '.clj': { language: 'clojure', grammar: null },
  '.groovy': { language: 'groovy', grammar: null },
  '.gradle': { language: 'groovy', grammar: null },
  '.fs': { language: 'fsharp', grammar: null },
  '.vb': { language: 'vbnet', grammar: null },
  '.pl': { language: 'perl', grammar: null },
  '.pm': { language: 'perl', grammar: null },
  '.r': { language: 'r', grammar: null },
  '.jl': { language: 'julia', grammar: null },
  '.hs': { language: 'haskell', grammar: null },
  '.nim': { language: 'nim', grammar: null },
  '.cr': { language: 'crystal', grammar: null },
  '.sql': { language: 'sql', grammar: null },
  '.graphql': { language: 'graphql', grammar: null },
  '.gql': { language: 'graphql', grammar: null },
  '.proto': { language: 'protobuf', grammar: null },
  '.yaml': { language: 'yaml', grammar: null },
  '.yml': { language: 'yaml', grammar: null },
  '.json': { language: 'json', grammar: null },
  '.toml': { language: 'toml', grammar: null },
  '.xml': { language: 'xml', grammar: null },
  '.ini': { language: 'ini', grammar: null },
  '.properties': { language: 'properties', grammar: null },
  '.conf': { language: 'config', grammar: null },
  '.cfg': { language: 'config', grammar: null },
  '.env.example': { language: 'config', grammar: null },
  '.html': { language: 'html', grammar: null },
  '.twig': { language: 'template', grammar: null },
  '.ejs': { language: 'template', grammar: null },
  '.hbs': { language: 'template', grammar: null },
  '.erb': { language: 'template', grammar: null },
  '.sh': { language: 'shell', grammar: 'bash' },
  '.bash': { language: 'shell', grammar: 'bash' },
  '.tf': { language: 'terraform', grammar: null },
};

const BY_NAME: Record<string, LanguageSpec> = {
  Dockerfile: { language: 'dockerfile', grammar: null },
  Makefile: { language: 'make', grammar: null },
  Gemfile: { language: 'ruby', grammar: 'ruby' },
  Rakefile: { language: 'ruby', grammar: 'ruby' },
  Procfile: { language: 'config', grammar: null },
};

export function languageOf(path: string): LanguageSpec | null {
  const name = posix.basename(path);
  return (
    BY_NAME[name] ?? BY_EXTENSION[posix.extname(name).toLowerCase()] ?? null
  );
}

/** Dependency manifests that reveal frameworks, in any ecosystem. */
export const DEPENDENCY_MANIFESTS = new Set([
  'package.json',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Gemfile',
  'Cargo.toml',
  'mix.exs',
  'pubspec.yaml',
]);

/** Dependency names (lowercase substrings) that identify web frameworks. */
export const FRAMEWORK_MARKERS: Record<string, string> = {
  '@nestjs/core': 'NestJS',
  '"express"': 'Express',
  fastify: 'Fastify',
  '"koa"': 'Koa',
  '"hono"': 'Hono',
  'next"': 'Next.js',
  'laravel/framework': 'Laravel',
  'symfony/': 'Symfony',
  'slim/slim': 'Slim',
  'spring-boot': 'Spring Boot',
  'io.micronaut': 'Micronaut',
  'io.quarkus': 'Quarkus',
  'io.ktor': 'Ktor',
  'github.com/gin-gonic/gin': 'Gin',
  'github.com/labstack/echo': 'Echo',
  'github.com/go-chi/chi': 'chi',
  'github.com/gofiber/fiber': 'Fiber',
  'github.com/gorilla/mux': 'gorilla/mux',
  django: 'Django',
  fastapi: 'FastAPI',
  flask: 'Flask',
  starlette: 'Starlette',
  'gem "rails"': 'Rails',
  "gem 'rails'": 'Rails',
  sinatra: 'Sinatra',
  'actix-web': 'Actix Web',
  axum: 'Axum',
  rocket: 'Rocket',
  phoenix: 'Phoenix',
  'microsoft.aspnetcore': 'ASP.NET Core',
};
