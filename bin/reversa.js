#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { clearTerminalForLogo, renderReversaLogo } from '../lib/utils/banner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

const [,, command, ...args] = process.argv;

const commands = {
  install:            () => import('../lib/commands/install.js'),
  update:             () => import('../lib/commands/update.js'),
  status:             () => import('../lib/commands/status.js'),
  scan:               () => import('../lib/commands/scan.js'),
  compare:            () => import('../lib/commands/compare.js'),
  gui:                () => import('../lib/commands/gui.js'),
  agent:              () => import('../lib/commands/agent.js'),
  dataset:            () => import('../lib/commands/dataset.js'),
  nebula:             () => import('../lib/commands/nebula.js'),
  uninstall:          () => import('../lib/commands/uninstall.js'),
  'add-agent':        () => import('../lib/commands/add-agent.js'),
  'add-engine':       () => import('../lib/commands/add-engine.js'),
  patterns:           () => import('../lib/commands/patterns.js'),
  'export-diagrams':  () => import('../lib/commands/export-diagrams.js'),
};

if (!command || command === '--help' || command === '-h') {
  clearTerminalForLogo();
  console.log(renderReversaLogo(chalk) + `

  reversa v${pkg.version}

  AI evidence, contradiction, and guarded patch-intelligence engine.

  Usage: npx reversa <command>

  Commands:
    scan               Scan a source tree and generate structured evidence
    compare            Compare two trees and classify differences
    gui                Generate a local dashboard for scan/compare results
    agent              Run local agent doctor/models/eval/memory/patch scaffolding
    dataset            Build local advisory datasets from bounded evidence
    nebula             Read-only Nebula phone companion status bridge
    install            Install compatibility agent workflow files
    update             Update installed compatibility agents
    status             Show current compatibility analysis state
    uninstall          Remove Reversa-created files from a project
    add-agent          Add a compatibility agent
    add-engine         Add engine support
    patterns           Print or write reusable Reversa pattern templates
    export-diagrams    Export Mermaid diagrams as SVG/PNG images
                       Options: --format=svg|png  --output=<folder>
                       Requires: npm install -g @mermaid-js/mermaid-cli

  Documentation: https://github.com/Fractal-Echo/Reversa-Matrix
  `);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(pkg.version);
  process.exit(0);
}

if (!commands[command]) {
  console.error(`\n  Unknown command: "${command}"`);
  console.error('  Run "npx reversa --help" to list available commands.\n');
  process.exit(1);
}

const mod = await commands[command]();
await mod.default(args);
