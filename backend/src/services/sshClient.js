/**
 * Thin wrapper around the `ssh2` package — the "CONNECTION ENGINE" from the
 * architecture doc. Every other engine (discovery, evidence, remediation,
 * provisioner, validation) goes through here rather than opening its own
 * connections, so timeout/retry/auth handling lives in exactly one place.
 *
 * This is real: connect() opens an actual SSH session to vm.ip and exec()
 * runs an actual command over it. It has not been exercised against a live
 * host in the environment this was written in (no outbound network there),
 * so treat it as "correct by construction" against the standard ssh2 API
 * until you've run it against your own VMs.
 */
const { Client } = require('ssh2');
const { shellSingleQuote } = require('./shellQuote');

const DEFAULT_TIMEOUT_MS = 10000;

function connect(vm, credential, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const config = {
      host: vm.ip,
      port: vm.port || 22,
      username: credential.username,
      readyTimeout: timeout,
    };

    if (credential.authType === 'ssh-key') {
      config.privateKey = credential.secret;
      if (credential.passphrase) config.passphrase = credential.passphrase;
    } else {
      config.password = credential.secret;
    }

    let settled = false;
    conn.on('ready', () => {
      if (settled) return;
      settled = true;
      resolve(conn);
    });
    conn.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    conn.connect(config);
  });
}

/**
 * Runs `command` over an already-open connection. With `sudo: true`, wraps
 * it as `sudo -S -p '' bash -c '<command>'` and writes the credential's
 * password to the sudo prompt over stdin (never as a CLI argument, so it
 * never appears in `ps`). For key-based auth with no password, this relies
 * on the remote user having passwordless (NOPASSWD) sudo configured for
 * automation — see README.md.
 */
function exec(conn, command, { sudo = false, password = null } = {}) {
  return new Promise((resolve, reject) => {
    const finalCommand = sudo
      ? `sudo -S -p '' bash -c ${shellSingleQuote(command)}`
      : command;

    conn.exec(finalCommand, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('close', (code) => {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code === null ? 1 : code });
      });
      stream.on('data', (data) => { stdout += data.toString(); });
      stream.stderr.on('data', (data) => { stderr += data.toString(); });

      if (sudo) {
        stream.write(`${password || ''}\n`);
      }
    });
  });
}

/** Opens a connection, runs `fn(conn)`, and always closes the connection afterward. */
async function withConnection(vm, credential, fn, opts) {
  const conn = await connect(vm, credential, opts);
  try {
    return await fn(conn);
  } finally {
    conn.end();
  }
}

module.exports = { connect, exec, withConnection, shellSingleQuote, DEFAULT_TIMEOUT_MS };
