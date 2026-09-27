// Thin wrapper around the cdn-uploader CLI (~/projects/cdn-uploader).
// All R2 operations delegate to that proven tool; this module just spawns it.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const UPLOADER_DIR = process.env.CDN_UPLOADER_DIR || join(homedir(), 'projects/cdn-uploader');
const CLI = join(UPLOADER_DIR, 'lib/bin/cli.js');

function run(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, ...args], { cwd: UPLOADER_DIR });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cdn-uploader timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

export async function uploadFile(localPath, key, contentType) {
  const args = ['upload', localPath, key];
  if (contentType) args.push('--content-type', contentType);
  const { code, out, err } = await run(args);
  if (code !== 0) throw new Error(`upload failed (${key}): ${err || out}`);
  const m = out.match(/https:\/\/cdn\.rbk\.dev\/\S+/);
  return { key, url: m ? m[0] : `https://cdn.rbk.dev/${key}` };
}

export async function verifyUrl(url) {
  const { code, out } = await run(['verify', url]);
  // verify exits non-zero on non-200; treat explicit "200" in output as success
  const ok = out.includes('200');
  return { url, ok, output: out.trim() };
}