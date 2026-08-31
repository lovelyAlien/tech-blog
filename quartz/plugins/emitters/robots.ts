import { FullSlug } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"
import { BuildCtx } from "../../util/ctx"

export const Robots: QuartzEmitterPlugin = () => ({
  name: "Robots",
  async *emit({ argv, cfg }) {
    const baseUrl = cfg.configuration.baseUrl
    const sitemapLine = baseUrl ? `\nSitemap: https://${baseUrl}/sitemap.xml\n` : ""
    const content = `User-agent: *\nAllow: /\n${sitemapLine}`

    yield write({
      ctx: { argv } as BuildCtx,
      slug: "robots" as FullSlug,
      ext: ".txt",
      content,
    })
  },
  async *partialEmit() {},
})
