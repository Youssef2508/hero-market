// A shop PC for the live end-to-end campaign: the real HeroMarket service on a disposable local
// database, with its real sync agent and the real HTTPS transport. Runs as its own process so the
// driver can kill it hard (a crash or power cut) and start it again on the same database.
const REPO = require('path').join(__dirname, '..', '..')
const { createService } = require(`${REPO}/src/server/app`)

;(async () => {
  const svc = await createService({
    databaseUrl: process.env.HM_DB,
    secret: process.env.HM_SECRET,
    timeZone: 'Africa/Cairo',
    appVersion: '1.6.1',
    syncAgent: true,
    agentKind: 'service',
    syncIntervalMs: 3000,
    logger: { level: 'warn' }
  })
  await svc.prepare()
  await svc.app.listen({ host: '127.0.0.1', port: Number(process.env.HM_PORT) })
  console.log('READY')
})().catch((e) => {
  console.error('shop failed:', e)
  process.exit(1)
})
