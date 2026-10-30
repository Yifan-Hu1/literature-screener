// End-to-end smoke test: launches the built app, clicks through the main
// workflow against the real PubMed, and saves screenshots to test-results/e2e/.
// Run with: npm run test:e2e
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'

const root = resolve(import.meta.dirname, '../..')
const shots = join(root, 'test-results/e2e')
mkdirSync(shots, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'ls-e2e-'))
const userData = join(work, 'userData')
const projects = join(work, 'projects')
mkdirSync(projects)

const errors = []
let app
let step = 0
// Shells started from VS Code may set this, which would make Electron behave like plain Node.
const env = { ...process.env, LS_USER_DATA_DIR: userData }
delete env.ELECTRON_RUN_AS_NODE
const launch = () => electron.launch({ executablePath: electronPath, args: [root], env })

async function stubFolderDialog(app, folder) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, folder)
}

async function shot(page, name) {
  step++
  await page.screenshot({ path: join(shots, `${String(step).padStart(2, '0')}-${name}.png`) })
  console.log(`  ✓ ${name}`)
}

function watch(page) {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
}

try {
  app = await launch()
  let page = await app.firstWindow()
  watch(page)
  await page.setViewportSize({ width: 1280, height: 840 })

  await page.getByPlaceholder('e.g. Jane Smith').fill('E2E Tester')
  await page.getByRole('button', { name: 'Continue' }).click()
  await shot(page, 'start')

  await page.getByRole('button', { name: 'New project…' }).click()
  await page.getByPlaceholder('e.g. Microglia in ALS models').fill('Zebrafish microglia')
  await page.locator('textarea').nth(0).fill('What is known about microglia in zebrafish?')
  await page.locator('textarea').nth(1).fill('Primary research in zebrafish\nMicroglia as a main focus')
  await page.locator('textarea').nth(2).fill('Reviews\nNo microglia data')
  await stubFolderDialog(app, projects)
  await page.getByRole('button', { name: 'Choose folder…' }).click()
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByRole('heading', { name: 'Zebrafish microglia' }).waitFor()
  await shot(page, 'overview-empty')

  await page.getByRole('button', { name: 'Search PubMed' }).click()
  const termInput = page.locator('.term-input').first()
  await termInput.fill('microglia')
  await termInput.press('Enter')
  await page.getByRole('button', { name: 'Suggest MeSH terms' }).click()
  await page.locator('.mesh-suggestion', { hasText: 'Microglia' }).first().getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: '+ Add another concept (AND)' }).click()
  await page.locator('.term-input').nth(1).fill('development, developmental')
  await page.getByRole('button', { name: 'Zebrafish', exact: true }).click()
  await page.getByRole('button', { name: 'Primary research only' }).click()
  const query = await page.locator('.query-box').innerText()
  if (!query.includes('"Microglia"[Mesh]') || !query.includes('developmental[tiab]') || !query.includes('NOT ("Review"[pt]')) {
    throw new Error(`Unexpected query: ${query}`)
  }
  await shot(page, 'search-builder')
  await page.getByPlaceholder('year').nth(0).fill('2020')
  await page.getByPlaceholder('year').nth(1).fill('2021')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByText(/results in PubMed/).waitFor({ timeout: 30000 })
  await shot(page, 'search-results')

  await page.getByRole('button', { name: 'Save to project' }).first().click()
  await page.getByText('✓ In project').first().waitFor()

  await page.getByRole('button', { name: /^Import all/ }).click()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByText(/Imported all \d+ records/).waitFor({ timeout: 120000 })
  await shot(page, 'search-imported')

  await page.getByRole('button', { name: /^Library/ }).click()
  await page.getByText(/Showing 1–/).waitFor()
  await shot(page, 'library')

  await page.getByRole('button', { name: /^Screening/ }).click()
  await page.getByText(/Record 1 of/).waitFor()
  await shot(page, 'screening-first')
  // Like a person: wait until the record is on screen before pressing a key.
  const onRecord = async (n) => {
    await page.getByText(`Record ${n} of`).waitFor()
    await page.locator('.screening-layout > div.card:not(.loading)').waitFor()
  }
  await onRecord(1)
  await page.keyboard.press('i')
  await onRecord(2)
  await page.keyboard.press('e')
  await onRecord(3)
  await page.keyboard.press('u')
  await onRecord(4)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await onRecord(2)
  await page.keyboard.press('i')
  await onRecord(3)
  await page.keyboard.press('ArrowLeft')
  await page.getByText('Record 2 of').waitFor()
  // Record 2 was excluded, then changed to include: both must be in its history.
  await page.locator('.history .badge').nth(1).waitFor()
  const history = await page.locator('.history .badge').allInnerTexts()
  if (history.join(',') !== 'Include,Exclude') throw new Error(`Unexpected history for record 2: ${history}`)
  await shot(page, 'screening-history')

  const screenedBefore = await page.getByRole('button', { name: /^Screening/ }).innerText()
  await app.close()

  // Reopen the app and the project: progress must be restored.
  app = await launch()
  page = await app.firstWindow()
  watch(page)
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.getByRole('button', { name: /Zebrafish microglia/ }).click()
  await page.getByRole('heading', { name: 'Zebrafish microglia' }).waitFor()
  const screenedAfter = await page.getByRole('button', { name: /^Screening/ }).innerText()
  if (screenedAfter !== screenedBefore) throw new Error(`Progress not restored: ${screenedBefore} vs ${screenedAfter}`)
  console.log(`  ✓ progress restored after restart (${screenedAfter.replace(/\s+/g, ' ')})`)
  await shot(page, 'overview-after-restart')

  await page.getByRole('button', { name: 'Settings' }).click()
  await shot(page, 'settings')
  await app.close()

  if (errors.length) throw new Error(`Console errors:\n${errors.join('\n')}`)
  console.log(`\nE2E smoke test passed. Screenshots: ${shots}`)
} catch (e) {
  console.error('\nE2E smoke test FAILED:', e.message)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  rmSync(work, { recursive: true, force: true })
}
