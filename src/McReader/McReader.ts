import {
  BasicRateLimiter,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  CloudflareBypassRequestProviding,
  CloudflareError,
  Cookie,
  DiscoverSection,
  DiscoverSectionItem,
  DiscoverSectionType,
  EndOfPageResults,
  Extension,
  MangaProviding,
  PagedResults,
  PaperbackInterceptor,
  Request,
  Response,
  SearchQuery,
  SearchResultItem,
  SearchResultsProviding,
  SourceManga,
  TagSection,
} from '@paperback/types'

import * as cheerio from 'cheerio'

import {
  parseChapterDetails,
  isLastPage,
  parseChapters,
  parseMangaDetails,
  parseViewMore,
  parseSearch,
  parseTags,
} from './McReaderParser'

import { Metadata } from './McReaderInterface'

const MCR_DOMAIN = 'https://www.mgeko.cc'

type McReaderImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  CloudflareBypassRequestProviding

class McReaderInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...(request.headers ?? {}),
      ...{
        'referer': `${MCR_DOMAIN}/`,
        'user-agent': await Application.getDefaultUserAgent(),
      },
    }
    return request
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async interceptResponse(request: Request, response: Response, data: ArrayBuffer): Promise<ArrayBuffer> {
    return data
  }
}

export class McReaderSource implements McReaderImplementation {
  cloudflareBypassDone = false
  globalRateLimiter = new BasicRateLimiter('rateLimiter', {
    numberOfRequests: 4,
    bufferInterval: 15000,
    ignoreImages: false,
  })

  mainRequestInterceptor = new McReaderInterceptor('main')

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor()
    this.mainRequestInterceptor.registerInterceptor()

    Application.registerDiscoverSection(
      {
        id: 'most_viewed',
        title: 'Most Viewed',
        type: DiscoverSectionType.simpleCarousel,
      },
      Application.Selector(this as McReaderSource, 'getMostViewedSectionItems'),
    )

    Application.registerDiscoverSection(
      {
        id: 'new',
        title: 'New',
        type: DiscoverSectionType.simpleCarousel,
      },
      Application.Selector(this as McReaderSource, 'getNewSectionItems'),
    )

    Application.registerDiscoverSection(
      {
        id: 'latest_updates',
        title: 'Latest Updates',
        type: DiscoverSectionType.simpleCarousel,
      },
      Application.Selector(this as McReaderSource, 'getLatestUpdatesSectionItems'),
    )

    Application.registerSearchFilter({
      id: 'excludeIncludeGenre',
      type: 'dropdown',
      options: [
        { id: 'true', value: 'Include Genres' },
        { id: 'false', value: 'Exclude Genres' },
      ],
      value: 'true',
      title: 'Genre Filter',
    })

    Application.registerSearchFilter({
      id: 'sortBy',
      type: 'dropdown',
      options: [
        { id: 'Random', value: 'Random' },
        { id: 'New', value: 'New' },
        { id: 'Updated', value: 'Updated' },
        { id: 'Views', value: 'Views' },
      ],
      value: 'Views',
      title: 'Sort By Filter',
    })

    try {
      const searchTags = await this.getSearchTags()

      for (const tags of searchTags) {
        Application.registerSearchFilter({
          type: 'multiselect',
          options: tags.tags.map(x => ({ id: x.id, value: x.title })),
          id: 'tags-' + tags.id,
          allowExclusion: false,
          title: tags.title,
          value: {},
        })
      }
    }
    catch (e) {
      console.log(e)
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
    this.cloudflareBypassDone = true
  }

  async getSearchTags(): Promise<TagSection[]> {
    const request: Request = {
      url: `${MCR_DOMAIN}/browse-comics`,
      method: 'GET',
    }

    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    return parseTags($)
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const request: Request = {
      url: `${MCR_DOMAIN}/manga/${mangaId}`,
      method: 'GET',
    }
    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    return parseMangaDetails($, mangaId)
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const request: Request = {
      url: `${MCR_DOMAIN}/manga/${sourceManga.mangaId}/all-chapters`,
      method: 'GET',
    }

    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    return parseChapters($, sourceManga)
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const request: Request = {
      url: `${MCR_DOMAIN}/reader/en/${chapter.chapterId}`,
      method: 'GET',
    }
    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    return parseChapterDetails($, chapter)
  }

  async getSearchResults(query: SearchQuery, metadata: Metadata | undefined): Promise<PagedResults<SearchResultItem>> {
    const page: number = metadata?.page ?? 1
    let request: Request

    // Regular search
    if (query.title) {
      request = {
        url: `${MCR_DOMAIN}/search/?search=${encodeURI(query.title)}`,
        method: 'GET',
      }

      // Tag Search
    }
    else {
      const getFilterValue = (id: string) => query.filters.find(filter => filter.id === id)?.value

      const genres = Object.keys(getFilterValue('genres') as Record<string, 'included' | 'excluded'>).join(',')
      const sortBy = getFilterValue('sortBy') as string
      const excludeIncludeGenre = getFilterValue('excludeIncludeGenre') as string

      const genreParams = genres ? `&included=${excludeIncludeGenre}&genres=${genres}` : ''

      request = {
        url: `${MCR_DOMAIN}/browse-advanced?sort_by=${sortBy}${genreParams}&results=${page.toString()}`,
        method: 'GET',
      }
    }

    const [response, data] = await Application.scheduleRequest(request)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    this.checkCloudflareStatus(response.status)
    const manga = parseSearch($)

    metadata = !isLastPage($) ? { page: page + 1 } : undefined
    const pagedResults: PagedResults<SearchResultItem> = {
      items: manga,
      metadata: metadata,
    }
    return pagedResults
  }

  async getMostViewedSectionItems(section: DiscoverSection, metadata: Metadata | undefined): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) return EndOfPageResults

    const page: number = metadata?.page ?? 1

    const request: Request = {
      url: `${MCR_DOMAIN}/browse-comics/?results=${page.toString()}&filter=Views`,
      method: 'GET',
    }
    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    const manga = parseViewMore($)
    metadata = !isLastPage($) ? { page: page + 1 } : undefined

    const pagedResults: PagedResults<DiscoverSectionItem> = {
      items: manga,
      metadata: metadata,
    }
    return pagedResults
  }

  async getNewSectionItems(section: DiscoverSection, metadata: Metadata | undefined): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) return EndOfPageResults

    const page: number = metadata?.page ?? 1

    const request: Request = {
      url: `${MCR_DOMAIN}/browse-comics/?results=${page.toString()}&filter=New`,
      method: 'GET',
    }
    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    const manga = parseViewMore($)
    metadata = !isLastPage($) ? { page: page + 1 } : undefined

    const pagedResults: PagedResults<DiscoverSectionItem> = {
      items: manga,
      metadata: metadata,
    }
    return pagedResults
  }

  async getLatestUpdatesSectionItems(section: DiscoverSection, metadata: Metadata | undefined): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) return EndOfPageResults

    const page: number = metadata?.page ?? 1

    const request: Request = {
      url: `${MCR_DOMAIN}/browse-comics/?results=${page.toString()}&filter=Updated`,
      method: 'GET',
    }
    const [response, data] = await Application.scheduleRequest(request)
    this.checkCloudflareStatus(response.status)
    const $ = cheerio.load(Application.arrayBufferToUTF8String(data))
    const manga = parseViewMore($)
    metadata = !isLastPage($) ? { page: page + 1 } : undefined

    const pagedResults: PagedResults<DiscoverSectionItem> = {
      items: manga,
      metadata: metadata,
    }
    return pagedResults
  }

  checkCloudflareStatus(status: number): void {
    if (status == 503 || status == 403) {
      if (!this.cloudflareBypassDone) {
        throw new CloudflareError({ url: MCR_DOMAIN, method: 'GET' })
      }
    }
  }
}
