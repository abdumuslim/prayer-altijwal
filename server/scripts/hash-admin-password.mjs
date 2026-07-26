#!/usr/bin/env node
/**
 * Produces the ADMIN_PASSWORD_HASH line for the VPS .env (docs/ADMIN_DASHBOARD.md).
 *
 * The digest format is self-describing so the verifier never has to guess the
 * cost parameters — they travel with the hash and can be raised later without
 * invalidating existing ones:
 *
 *   scrypt$<N>$<r>$<p>$<saltBase64url>$<hashBase64url>
 *
 * Usage (preferred — the password never lands in shell history):
 *   node scripts/hash-admin-password.mjs
 *   <type the password, press Enter>
 *
 * Or piped, for non-interactive use:
 *   printf '%s' 'the password' | node scripts/hash-admin-password.mjs
 *
 * An argv password is accepted but warned about, since it is visible in the
 * process list and the shell history.
 */
import { randomBytes, scryptSync } from "node:crypto";

// ~16 MB of memory per hash (128 * N * r): slow enough to make offline guessing
// expensive, small enough to stay under Node's default 32 MB scrypt maxmem.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

const MIN_LENGTH = 12;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      // Interactive use: stop at the first newline rather than waiting for EOF.
      if (data.includes("\n")) {
        process.stdin.pause();
        resolve(data);
      }
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function readPassword() {
  const fromArgv = process.argv[2];
  if (fromArgv) {
    process.stderr.write(
      "warning: password passed as an argument — it is visible in the process\n" +
        "         list and your shell history. Prefer piping it on stdin.\n",
    );
    return fromArgv;
  }
  if (process.stdin.isTTY) {
    process.stderr.write("Admin password (input is echoed — clear your terminal after): ");
  }
  const raw = await readStdin();
  return raw.replace(/\r?\n$/, "");
}

const password = await readPassword();

if (!password) {
  process.stderr.write("error: no password provided\n");
  process.exit(1);
}
if (password.length < MIN_LENGTH) {
  process.stderr.write(
    `error: password must be at least ${MIN_LENGTH} characters (got ${password.length}).\n` +
      "       This is the only credential guarding the dashboard.\n",
  );
  process.exit(1);
}

const salt = randomBytes(SALT_BYTES);
const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
const digest = [
  "scrypt",
  N,
  R,
  P,
  salt.toString("base64url"),
  hash.toString("base64url"),
].join("$");

// stdout carries ONLY the pasteable line, so `... | tail -1` and copy/paste both
// work. Everything explanatory goes to stderr.
process.stderr.write("\nPaste this into /opt/prayer/.env (and record it in docs/OPERATIONS.md):\n\n");
process.stdout.write(`ADMIN_PASSWORD_HASH=${digest}\n`);
process.stderr.write(
  "\nAlso set ADMIN_SESSION_SECRET, or admin sessions drop on every restart:\n" +
    `ADMIN_SESSION_SECRET=${randomBytes(32).toString("base64url")}\n` +
    "\nAnd, for the anonymous audience ping:\n" +
    `TELEMETRY_SALT=${randomBytes(24).toString("base64url")}\n`,
);
