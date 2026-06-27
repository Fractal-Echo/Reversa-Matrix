const LOGO_LINES = [
  ' ____                                     __  __       _        _      ',
  '|  _ \\ _____   _____ _ __ ___  __ _     |  \\/  | __ _| |_ _ __(_)_  __',
  "| |_) / _ \\ \\ / / _ \\ '__/ __|/ _` |____| |\\/| |/ _` | __| '__| \\ \\/ /",
  '|  _ <  __/\\ V /  __/ |  \\__ \\ (_| |____| |  | | (_| | |_| |  | |>  < ',
  '|_| \\_\\___| \\_/ \\___|_|  |___/\\__,_|    |_|  |_|\\__,_|\\__|_|  |_/_/\\_\\',
];

const LOGO_COLOR = '#40d88f';
const SUBTITLE = 'AI evidence | contradictions | guarded patch intelligence';

export function clearTerminalForLogo() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
}

export function renderReversaLogo(chalk) {
  const logo = chalk.hex(LOGO_COLOR);
  const maxWidth = Math.max(...LOGO_LINES.map(line => line.length));

  return LOGO_LINES
    .map(line => logo(line.padEnd(maxWidth)))
    .concat(chalk.gray(SUBTITLE))
    .join('\n');
}
