import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

const isIndex = (props: any) => props.fileData.slug === "index"
const notIndex = (props: any) => props.fileData.slug !== "index"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {
      GitHub: "https://github.com/jackyzha0/quartz",
      "Discord Community": "https://discord.gg/cRFFHYye7t",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    // 홈페이지 전용: 최근 글 + 전체 글 섹션
    Component.ConditionalRender({
      component: Component.HomepageHero(),
      condition: isIndex,
    }),
    // 일반 글 페이지 요소 (홈에서 숨김)
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: notIndex,
    }),
    Component.ConditionalRender({
      component: Component.ArticleTitle(),
      condition: notIndex,
    }),
    Component.ConditionalRender({
      component: Component.ContentMeta(),
      condition: notIndex,
    }),
    Component.ConditionalRender({
      component: Component.TagList(),
      condition: notIndex,
    }),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
      ],
    }),
    // 홈페이지에서 Explorer 숨김
    Component.ConditionalRender({
      component: Component.Explorer(),
      condition: notIndex,
    }),
  ],
  right: [
    // 홈페이지에서 우측 사이드바 숨김
    Component.ConditionalRender({
      component: Component.Graph(),
      condition: notIndex,
    }),
    Component.ConditionalRender({
      component: Component.DesktopOnly(Component.TableOfContents()),
      condition: notIndex,
    }),
    Component.ConditionalRender({
      component: Component.Backlinks(),
      condition: notIndex,
    }),
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
      ],
    }),
    Component.Explorer(),
  ],
  right: [],
}
