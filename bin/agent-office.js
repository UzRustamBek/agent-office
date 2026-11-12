#!/usr/bin/env node
import { main } from '../server/cli.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
