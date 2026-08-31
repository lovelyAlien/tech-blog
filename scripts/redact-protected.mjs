// Strips password-protected pages out of Quartz's public search index, RSS feed,
// and sitemap. These are generated separately from the HTML pages and are not
// covered by the post-build StatiCrypt password gate, so without this step the
// full plaintext of a "protected" note leaks through /static/contentIndex.json
// (search + graph view data) and /index.xml (RSS) even though the .html page
// itself is encrypted.
import fs from "node:fs"
import path from "node:path"

const publicDir = "public"
const protectedPrefix = "Tech/면접답변"

function redactContentIndex() {
  const file = path.join(publicDir, "static", "contentIndex.json")
  if (!fs.existsSync(file)) return
  const data = JSON.parse(fs.readFileSync(file, "utf-8"))
  let removed = 0
  for (const slug of Object.keys(data)) {
    if (slug === protectedPrefix || slug.startsWith(`${protectedPrefix}/`)) {
      delete data[slug]
      removed++
    }
  }
  fs.writeFileSync(file, JSON.stringify(data))
  console.log(`contentIndex.json: removed ${removed} protected entries`)
}

function redactXmlBlocks(fileName, blockTag) {
  const file = path.join(publicDir, fileName)
  if (!fs.existsSync(file)) return
  const original = fs.readFileSync(file, "utf-8")
  const openTag = `<${blockTag}>`
  const closeTag = `</${blockTag}>`
  const parts = original.split(openTag)
  let removed = 0
  const kept = [parts[0]]
  for (let i = 1; i < parts.length; i++) {
    const closeIdx = parts[i].indexOf(closeTag)
    const block = parts[i].slice(0, closeIdx + closeTag.length)
    const rest = parts[i].slice(closeIdx + closeTag.length)
    let decoded = block
    try {
      decoded = decodeURIComponent(block)
    } catch {
      // block may contain a raw '%' that isn't valid percent-encoding; ignore
    }
    if (decoded.includes(protectedPrefix)) {
      removed++
      kept.push(rest)
    } else {
      kept.push(openTag + block + rest)
    }
  }
  fs.writeFileSync(file, kept.join(""))
  console.log(`${fileName}: removed ${removed} protected <${blockTag}> blocks`)
}

redactContentIndex()
redactXmlBlocks("index.xml", "item")
redactXmlBlocks("sitemap.xml", "url")
