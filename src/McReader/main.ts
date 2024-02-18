import {
    Chapter,
    ChapterDetails,
    ChapterProviding,
    DiscoverSectionType,
    EndOfPageResults,
    Extension,
    SourceManga,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchResultsProviding,
    SearchQuery,
    SimpleCarouselDiscoverItem,
    TagSection,
    Tag,
    SearchResultItem
} from '@paperback/types'

import {
    parseChapterDetails,
    isLastPage,
    parseChapters,
    parseMangaDetails,
    parseViewMore,
    parseSearch,
    parseTags
} from './parser'

import { Metadata } from './interface'

import * as cheerio from "cheerio"

const MCR_DOMAIN = 'https://www.mgeko.com'

type McReaderImplementation = Extension &
    SearchResultsProviding &
    MangaProviding &
    ChapterProviding

class McReaderSource implements McReaderImplementation {
    cheerio = cheerio;

    async initialise(): Promise<void> {
        Application.registerInterceptor(
            "main",
            Application.Selector(
                this as McReaderSource,
                "interceptRequest"
            ),
            Application.Selector(
                this as McReaderSource,
                "interceptResponse"
            )
        )

        Application.registerDiscoverSection(
            {
                id: "most_viewed",
                title: "Most Viewed",
                type: DiscoverSectionType.simpleCarousel,
            },
            Application.Selector(
                this as McReaderSource,
                "getMostViewedSectionItems"
            )
        )

        Application.registerDiscoverSection(
            {
                id: "new",
                title: "New",
                type: DiscoverSectionType.simpleCarousel,
            },
            Application.Selector(
                this as McReaderSource,
                "getNewSectionItems"
            )
        )

        Application.registerDiscoverSection(
            {
                id: "updated",
                title: "Latest Updated",
                type: DiscoverSectionType.simpleCarousel,
            },
            Application.Selector(
                this as McReaderSource,
                "getUpdatedSectionItems"
            )
        )
    }


    async interceptRequest(request: Request): Promise<Request> {
        request.headers = {
            ...(request.headers ?? {}),
            ...{
                referer: `${MCR_DOMAIN}/`,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        }
        return request
    }

    async interceptResponse(
        request: Request,
        response: Response,
        data: ArrayBuffer
    ): Promise<ArrayBuffer> {
        return data
    }

    getMangaShareUrl(mangaId: string): string { return `${MCR_DOMAIN}/manga/${mangaId}` }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request: Request = {
            url: `${MCR_DOMAIN}/manga/${mangaId}`,
            method: "GET",
        }
        const [response, data] = await Application.scheduleRequest(request)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        return parseMangaDetails($, mangaId)
    }

    async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        const request: Request = {
            url: `${MCR_DOMAIN}/manga/${sourceManga.mangaId}/all-chapters`,
            method: "GET",
        }

        const [response, data] = await Application.scheduleRequest(request)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        return parseChapters($, sourceManga)
    }

    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        const request: Request = {
            url: `${MCR_DOMAIN}/reader/en/${chapter.chapterId}`,
            method: "GET",
        }
        const [response, data] = await Application.scheduleRequest(request)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        return parseChapterDetails($, chapter)
    }

    async getMostViewedSectionItems(metadata: Metadata | undefined): Promise<PagedResults<unknown>> {
        if (metadata?.completed) return EndOfPageResults
    
        const page: number = metadata?.page ?? 1

        const request: Request = {
            url: `${MCR_DOMAIN}/browse-comics/?results=${page}&filter=views`,
            method: "GET",
        }
        const [response, data] = await Application.scheduleRequest(request)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        const manga = parseViewMore($)
        metadata = !isLastPage($) ? { page: page + 1 } : undefined

        const pagedResults: PagedResults<SimpleCarouselDiscoverItem> = {
            items: manga,
            metadata: metadata
        }
        return pagedResults
    }

    async getUpdatedSectionItems(metadata: Metadata | undefined): Promise<PagedResults<unknown>> {
        if (metadata?.completed) return EndOfPageResults
    
        const page: number = metadata?.page ?? 1

        const request: Request = {
            url: `${MCR_DOMAIN}/browse-comics/?results=${page}&filter=Updated`,
            method: "GET",
        }
        const [response, data] = await Application.scheduleRequest(request)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        const manga = parseViewMore($)
        metadata = !isLastPage($) ? { page: page + 1 } : undefined

        const pagedResults: PagedResults<SimpleCarouselDiscoverItem> = {
            items: manga,
            metadata: metadata
        }
        return pagedResults
    }

    async getNewSectionItems(metadata: Metadata | undefined): Promise<PagedResults<unknown>> {
        if (metadata?.completed) return EndOfPageResults
    
        const page: number = metadata?.page ?? 1

        const request: Request = {
            url: `${MCR_DOMAIN}/browse-comics/?results=${page}&filter=New`,
            method: "GET",
        }
        const [response, data] = await Application.scheduleRequest(request)
        this.CloudFlareError(response.status)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        const manga = parseViewMore($)
        metadata = !isLastPage($) ? { page: page + 1 } : undefined

        const pagedResults: PagedResults<SimpleCarouselDiscoverItem> = {
            items: manga,
            metadata: metadata
        }
        return pagedResults
    }

    async getSearchTags(): Promise<TagSection[]> {
        const request: Request = {
            url: `${MCR_DOMAIN}/browse-comics`,
            method: "GET",
        }

        const [response, data] = await Application.scheduleRequest(request)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        this.CloudFlareError(response.status)
        return parseTags($)
    }

    async getSearchResults(query: SearchQuery, metadata: any): Promise<PagedResults<SearchResultItem>> {
        const page: number = metadata?.page ?? 1
        let request: Request

        // Regular search
        if (query.title) {
            request = {
                url: `${MCR_DOMAIN}/search/?search=${encodeURI(query.title ?? '')}`,
                method: "GET",
            }

        // Tag Search
        } else {
            request = {
                url: `${MCR_DOMAIN}/browse-comics?genre=${query?.includedTags?.map((x: Tag) => x.id)[0]}&results=${page}`,
                method: "GET",
            }
        }

        const [response, data] = await Application.scheduleRequest(request)
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data))
        this.CloudFlareError(response.status)
        const manga = parseSearch($)

        metadata = !isLastPage($) ? { page: page + 1 } : undefined
        const pagedResults: PagedResults<SearchResultItem> = {
            items: manga,
            metadata: metadata
        }
        return pagedResults
    }

    CloudFlareError(status: number): void {
        if (status == 503 || status == 403) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of <MCReader> and press the cloud icon.`)
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        const request: Request = {
            url: MCR_DOMAIN,
            method: "GET",
            headers: {
                referer: `${MCR_DOMAIN}/`,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        }
        return request
    }
}

export const McReader = new McReaderSource()
