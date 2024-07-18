import {
    SourceIntents,
    ContentRating
} from '@paperback/types'

export default {
    icon: 'icon.png',
    name: 'McReader',
    version: '3.0.0',
    description: 'Extension that pulls manga from mcreader.net (Manga-Raw.club)',
    contentRating: ContentRating.MATURE,
    developers: [
        {
            name: 'Netsky',
            website: 'https://github.com/TheNetsky'
        }
    ],
    badges: [],
    capabilities: [
        SourceIntents.COLLECTION_MANAGEMENT,
        SourceIntents.MANGA_CHAPTERS,
        SourceIntents.MANGA_TRACKING,
        SourceIntents.HOMEPAGE_SECTIONS,
        SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
        SourceIntents.MANGA_SEARCH
    ]
}
