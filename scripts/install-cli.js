#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

async function installCli() {
  const zhihuPostDir = path.join(os.homedir(), '.zhihupost');
  const cliDir = path.join(zhihuPostDir, 'cli');

  // Create directories
  await fs.promises.mkdir(zhihuPostDir, { recursive: true, mode: 0o750 });

  // Determine source paths
  const projectRoot = path.dirname(__dirname);
  const outDir = path.join(projectRoot, 'out');

  // Copy entire out directory to cli (preserves structure)
  if (fs.existsSync(cliDir)) {
    await fs.promises.rm(cliDir, { recursive: true, force: true });
  }
  await copyDir(outDir, cliDir);

  // Make the CLI entry point executable
  const cliEntry = path.join(cliDir, 'cli', 'index.js');
  if (fs.existsSync(cliEntry)) {
    let content = await fs.promises.readFile(cliEntry, 'utf8');
    // Add shebang at the beginning if not present
    if (!content.startsWith('#!/usr/bin/env node')) {
      content = '#!/usr/bin/env node\n' + content;
      await fs.promises.writeFile(cliEntry, content, 'utf8');
    }
    await fs.promises.chmod(cliEntry, 0o755);
  }

  console.log('CLI installed successfully to', cliDir);
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true, mode: 0o750 });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

installCli().catch(err => {
  console.error('Failed to install CLI:', err);
  process.exit(1);
});
