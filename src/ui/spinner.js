const FRAMES = ["|", "/", "-", "\\"];

/**
 * Shows a spinner while `task` runs. Draws nothing when stdout is not a terminal,
 * so piped and agent output stays clean.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function withSpinner(label, task) {
  if (!process.stdout.isTTY) {
    return task();
  }

  let frame = 0;
  process.stdout.write(`${label} `);
  const timer = setInterval(() => {
    process.stdout.write(`\r${label} ${FRAMES[frame % FRAMES.length]}`);
    frame += 1;
  }, 90);

  try {
    return await task();
  } finally {
    clearInterval(timer);
    process.stdout.write(`\r${" ".repeat(label.length + 2)}\r`);
  }
}
