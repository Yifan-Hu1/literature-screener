// Renders an HTML file to PDF with Electron's Chromium.
// Usage: electron scripts/render-pdf.cjs <input.html> <output.pdf>
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const [input, output] = process.argv.slice(-2)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadFile(resolve(input))
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  writeFileSync(resolve(output), pdf)
  app.quit()
})
