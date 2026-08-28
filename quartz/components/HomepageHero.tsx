import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { resolveRelative } from "../util/path"
import { byDateAndAlphabetical } from "./PageList"
import { Date, getDate } from "./Date"
import { QuartzPluginData } from "../plugins/vfile"
import style from "./styles/homepageHero.scss"

const RECENT_LIMIT = 3
const NEW_BADGE_DAYS = 7

function isPublished(f: QuartzPluginData): boolean {
  return (
    f.frontmatter?.draft !== true &&
    !!f.frontmatter?.title &&
    f.slug !== "index"
  )
}

function isNew(cfg: QuartzComponentProps["cfg"], page: QuartzPluginData): boolean {
  if (!page.dates) return false
  const date = getDate(cfg, page)
  if (!date) return false
  const diffDays = (globalThis.Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays <= NEW_BADGE_DAYS
}

export default (() => {
  const HomepageHero: QuartzComponent = ({ allFiles, fileData, cfg }: QuartzComponentProps) => {
    const sorter = byDateAndAlphabetical(cfg)
    const posts = allFiles.filter(isPublished).sort(sorter)
    const recentPosts = posts.slice(0, RECENT_LIMIT)

    return (
      <div class="homepage-hero">
        {/* 최근 게시글 섹션 */}
        <section class="recent-section">
          <h2 class="section-heading">최근 게시글</h2>
          <div class="recent-grid">
            {recentPosts.map((page) => {
              const title = page.frontmatter?.title ?? "제목 없음"
              const tags = page.frontmatter?.tags ?? []
              const description = page.frontmatter?.description as string | undefined

              return (
                <a
                  href={resolveRelative(fileData.slug!, page.slug!)}
                  class="recent-card"
                >
                  <div class="card-body">
                    <div class="card-tags">
                      {tags.slice(0, 2).map((tag) => (
                        <span class="card-tag">{tag}</span>
                      ))}
                    </div>
                    <h3 class="card-title">{title}</h3>
                    {description && <p class="card-desc">{description}</p>}
                  </div>
                  <div class="card-footer">
                    {page.dates && (
                      <span class="card-date">
                        <Date date={getDate(cfg, page)!} locale={cfg.locale} />
                      </span>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        </section>

        {/* 전체 게시글 섹션 */}
        <section class="all-section">
          <h2 class="section-heading">전체 게시글</h2>
          <ul class="all-list">
            {posts.map((page) => {
              const title = page.frontmatter?.title ?? "제목 없음"
              const tags = page.frontmatter?.tags ?? []

              return (
                <li class="all-item">
                  <a
                    href={resolveRelative(fileData.slug!, page.slug!)}
                    class="all-item-link"
                  >
                    <div class="all-item-meta">
                      {page.dates && (
                        <span class="all-item-date">
                          <Date date={getDate(cfg, page)!} locale={cfg.locale} />
                        </span>
                      )}
                      {tags.slice(0, 1).map((tag) => (
                        <span class="all-item-tag">{tag}</span>
                      ))}
                    </div>
                    <span class="all-item-title">
                      {title}
                      {isNew(cfg, page) && <span class="new-badge">NEW</span>}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    )
  }

  HomepageHero.css = style
  return HomepageHero
}) satisfies QuartzComponentConstructor
