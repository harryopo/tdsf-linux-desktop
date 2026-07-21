const { _electron: electron } = require('@playwright/test')
const path = require('node:path')

;(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'test-electron.cjs')],
    timeout: 60000,
  })
  const page = await app.firstWindow({ timeout: 30000 })
  console.log('Electron launched successfully')
  console.log('Windows:', await app.windows().then(w => w.length))
  await app.close()
})().catch(err => {
  console.error(err)
  process.exit(1)
})
