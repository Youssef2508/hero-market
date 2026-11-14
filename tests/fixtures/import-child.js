'use strict'
// A service in its own process for tests/service/importJobsCrash.test.js: it carries out import
// jobs and prints each step, so the test can kill it at a chosen moment (a crash, not a close).
//   node import-child.js <database url>
const { createService } = require('../../src/server/app')

;(async () => {
  const svc = await createService({
    databaseUrl: process.argv[2],
    secret: 'test-secret-'.padEnd(40, 'x'),
    logger: false,
    timeZone: 'Africa/Cairo',
    importPollMs: 100,
    importOnStep: async (stage, done) => {
      process.stdout.write(`step ${stage} ${done}\n`)
      // Slow enough to be killed in the middle.
      await new Promise((r) => setTimeout(r, 30))
    }
  })
  await svc.prepare()
  await svc.app.ready()
  process.stdout.write('ready\n')
})().catch((e) => {
  process.stderr.write(`${e.stack}\n`)
  process.exit(1)
})
