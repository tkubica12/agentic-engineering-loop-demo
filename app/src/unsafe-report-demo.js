import { exec } from 'node:child_process';

/**
 * INTENTIONALLY VULNERABLE DEMONSTRATION CODE.
 *
 * This branch must never be merged. It exists so CodeQL can show a real
 * command-injection dataflow from attacker-controlled HTTP input to a shell.
 */
export function unsafeStockReport(searchParams, callback) {
  const sku = searchParams.get('sku');
  exec(`echo stock-report:${sku}`, callback);
}
