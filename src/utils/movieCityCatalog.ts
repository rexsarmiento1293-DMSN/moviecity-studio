import rawCatalog from '../data/movieCityCatalog.json';
import { DramaScene, CharacterProfile } from './dramaStudioLogic';

export interface MovieCityItem {
  id: string;
  type: 'Movie' | 'TV Show' | string;
  title: string;
  director: string;
  cast: string;
  country: string;
  dateAdded: string;
  releaseYear: number;
  rating: string;
  duration: string;
  genres: string[];
  description: string;
}

export const MOVIE_CITY_CATALOG: MovieCityItem[] = rawCatalog as MovieCityItem[];

export interface CatalogFilterOptions {
  search?: string;
  type?: 'all' | 'Movie' | 'TV Show';
  genre?: string;
  rating?: string;
  yearMin?: number;
  yearMax?: number;
  sortBy?: 'year-desc' | 'year-asc' | 'title-asc' | 'title-desc';
}

export interface CatalogStats {
  totalCount: number;
  moviesCount: number;
  tvShowsCount: number;
  allGenres: string[];
  allRatings: string[];
  minYear: number;
  maxYear: number;
}

export function getCatalogStats(): CatalogStats {
  let moviesCount = 0;
  let tvShowsCount = 0;
  const genresSet = new Set<string>();
  const ratingsSet = new Set<string>();
  let minYear = 3000;
  let maxYear = 0;

  for (const item of MOVIE_CITY_CATALOG) {
    if (item.type === 'Movie') moviesCount++;
    else if (item.type === 'TV Show') tvShowsCount++;

    for (const g of item.genres) {
      if (g) genresSet.add(g);
    }
    if (item.rating && item.rating !== 'NR') {
      ratingsSet.add(item.rating);
    }
    if (item.releaseYear > 0) {
      if (item.releaseYear < minYear) minYear = item.releaseYear;
      if (item.releaseYear > maxYear) maxYear = item.releaseYear;
    }
  }

  return {
    totalCount: MOVIE_CITY_CATALOG.length,
    moviesCount,
    tvShowsCount,
    allGenres: Array.from(genresSet).sort(),
    allRatings: Array.from(ratingsSet).sort(),
    minYear: minYear === 3000 ? 1928 : minYear,
    maxYear: maxYear === 0 ? 2022 : maxYear,
  };
}

export function filterMovieCityCatalog(opts: CatalogFilterOptions = {}): MovieCityItem[] {
  const query = (opts.search || '').trim().toLowerCase();
  const type = opts.type && opts.type !== 'all' ? opts.type : null;
  const genre = opts.genre && opts.genre !== 'all' ? opts.genre.toLowerCase() : null;
  const rating = opts.rating && opts.rating !== 'all' ? opts.rating : null;
  const yearMin = opts.yearMin ?? 0;
  const yearMax = opts.yearMax ?? 3000;

  const filtered = MOVIE_CITY_CATALOG.filter((item) => {
    if (type && item.type !== type) return false;
    if (rating && item.rating !== rating) return false;
    if (item.releaseYear && (item.releaseYear < yearMin || item.releaseYear > yearMax)) {
      return false;
    }
    if (genre && !item.genres.some((g) => g.toLowerCase() === genre)) {
      return false;
    }

    if (!query) return true;

    return (
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.cast.toLowerCase().includes(query) ||
      item.director.toLowerCase().includes(query) ||
      item.genres.some((g) => g.toLowerCase().includes(query)) ||
      item.country.toLowerCase().includes(query) ||
      String(item.releaseYear).includes(query)
    );
  });

  const sortBy = opts.sortBy || 'year-desc';
  return filtered.sort((a, b) => {
    if (sortBy === 'year-desc') return (b.releaseYear || 0) - (a.releaseYear || 0);
    if (sortBy === 'year-asc') return (a.releaseYear || 0) - (b.releaseYear || 0);
    if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
    if (sortBy === 'title-desc') return b.title.localeCompare(a.title);
    return 0;
  });
}

/**
 * Builds a 3!2!1! Akzyon story prompt adaptation from any catalog title.
 */
export function buildAkzyonAdaptationPrompt(item: MovieCityItem): string {
  const mainGenre = item.genres[0] || 'Drama';
  return `3!2!1! Akzyon Pinoy Teleserye Adaptation ng "${item.title}": Sa gitna ng mataong Maynila, isang matinding kwento ng ${mainGenre.toLowerCase()} at lihim ng pamilya ang sumiklab. ${item.description} Ang bida ay buong tapang na haharap sa matinding pagsubok ng tadhana.`;
}

/**
 * Creates 3 default storyboard scenes from a catalog title for direct loading into 3!2!1! Akzyon Studio.
 */
export function createDefaultScenesFromMovie(item: MovieCityItem): DramaScene[] {
  const ts = Date.now();
  return [
    {
      id: `sc-catalog-${ts}-1`,
      order: 1,
      title: `Eksena 1: Simula ng "${item.title}"`,
      scriptText: `Nagsisimula ang kwento sa pagdating ng bida. "${item.description.slice(0, 110)}"`,
      visualPrompt: `Cinematic wide angle, ${item.title} style aesthetic, dramatic lighting, 35mm film grain, moody atmosphere, 4K resolution`,
      durationSec: 4,
      thumbnailDataUrl: '/media/image_clara_manila_noir.png',
      effectId: 'manila-noir',
      status: 'ready',
    },
    {
      id: `sc-catalog-${ts}-2`,
      order: 2,
      title: `Eksena 2: Ang Pagtutuos`,
      scriptText: `Nagkaharap ang mga pangunahing tauhan sa isang madramang tagpo. Direksyon: ${item.director || 'Direk Akzyon'}.`,
      visualPrompt: `Medium close-up shot, intense facial expression, cinematic rim light, rain-soaked city street, 24fps filmic realism`,
      durationSec: 4,
      thumbnailDataUrl: '/media/test_success.png',
      effectId: 'manila-noir',
      status: 'ready',
    },
    {
      id: `sc-catalog-${ts}-3`,
      order: 3,
      title: `Eksena 3: 3!2!1! Akzyon Finale`,
      scriptText: `Ang hindi malilimutang pagtatapos kung saan lumabas ang tunay na katotohanan!`,
      visualPrompt: `Epic slow dolly backward, golden sunset hour in Manila skyline, cinematic lens flare, emotional climax`,
      durationSec: 4,
      thumbnailDataUrl: '/media/akzyon_teleserye_episode1_final.jpg',
      effectId: 'golden-hour',
      status: 'ready',
    },
  ];
}
