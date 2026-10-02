/**
 * Safely embeds arbitrary text (real newlines, quotes, $, backticks — any
 * of it) as a single POSIX shell argument. Single quotes suppress all
 * shell interpretation except for a single quote itself, which is escaped
 * with the standard '\'' technique (close the quote, emit an escaped
 * literal quote, reopen the quote).
 *
 * This used to be inlined in sshClient.js using JSON.stringify() instead
 * of proper shell quoting, which converts real newlines into a literal
 * two-character `\n` sequence — valid JSON, but bash's double-quote
 * parsing never converts that back into an actual newline, so any
 * multi-line command (like validationEngine's KUBECONFIG_PREAMBLE) came
 * out as one unparseable line and failed with a syntax error. Reproduced
 * and fixed by switching to real single-quote escaping, which doesn't
 * have that failure mode. Pulled into its own module (no dependency on
 * `ssh2`) so it can be unit tested / reused without needing a real SSH
 * connection available.
 */
function shellSingleQuote(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

module.exports = { shellSingleQuote };
