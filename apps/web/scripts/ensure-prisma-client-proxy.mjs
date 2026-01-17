import fs from 'node:fs/promises';
import path from 'node:path';

function toPosixPath(p) {
  return p.replaceAll('\\', '/');
}

function ensureDotSlash(relPath) {
  if (relPath.startsWith('.') || relPath.startsWith('/')) return relPath;
  return `./${relPath}`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeIfChanged(filePath, content) {
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === content) return;
  } catch {
    // ignore
  }
  await fs.writeFile(filePath, content, 'utf8');
}

async function main() {
  const webRoot = process.cwd();

  const generatedClientDir = path.join(webRoot, 'node_modules', '.prisma', 'client');
  const prismaClientDotPrismaDir = path.join(webRoot, 'node_modules', '@prisma', 'client', '.prisma', 'client');

  if (!(await fileExists(generatedClientDir))) {
    console.warn(`[ensure-prisma-client-proxy] Skip: missing ${generatedClientDir}`);
    return;
  }

  await fs.mkdir(prismaClientDotPrismaDir, { recursive: true });

  const entrypoints = ['default', 'edge', 'wasm', 'index', 'client'];

  for (const name of entrypoints) {
    const srcBase = path.join(generatedClientDir, name);

    const srcJs = `${srcBase}.js`;
    const srcDts = `${srcBase}.d.ts`;

    const hasJs = await fileExists(srcJs);
    const hasDts = await fileExists(srcDts);

    if (!hasJs && !hasDts) continue;

    const destBase = path.join(prismaClientDotPrismaDir, name);

    if (hasJs) {
      const rel = ensureDotSlash(toPosixPath(path.relative(prismaClientDotPrismaDir, srcBase)));
      await writeIfChanged(
        `${destBase}.js`,
        `module.exports = require(${JSON.stringify(rel)});\n`
      );
    }

    if (hasDts) {
      const rel = ensureDotSlash(toPosixPath(path.relative(prismaClientDotPrismaDir, srcBase)));
      await writeIfChanged(
        `${destBase}.d.ts`,
        `export * from ${JSON.stringify(rel)};\n`
      );
    }
  }
}

await main();
