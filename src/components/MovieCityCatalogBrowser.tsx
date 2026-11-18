import React, { useMemo, useState } from 'react';
import {
  Film,
  Tv,
  Search,
  Filter,
  Sparkles,
  Play,
  Clapperboard,
  Download,
  Calendar,
  Clock,
  User,
  Tag,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  X,
  Layers,
} from 'lucide-react';
import {
  MovieCityItem,
  MOVIE_CITY_CATALOG,
  filterMovieCityCatalog,
  getCatalogStats,
  buildAkzyonAdaptationPrompt,
  createDefaultScenesFromMovie,
} from '../utils/movieCityCatalog';
import { DramaScene } from '../utils/dramaStudioLogic';

export interface MovieCityCatalogBrowserProps {
  onLoadMovieIntoStudio?: (opts: {
    title: string;
    prompt: string;
    scenes: DramaScene[];
    director?: string;
    cast?: string;
  }) => void;
  onPlayMoviePreview?: (title: string, description: string) => void;
  className?: string;
}

const ITEMS_PER_PAGE = 24;

export const MovieCityCatalogBrowser: React.FC<MovieCityCatalogBrowserProps> = ({
  onLoadMovieIntoStudio,
  onPlayMoviePreview,
  className = '',
}) => {
  const stats = useMemo(() => getCatalogStats(), []);

  // Filter States
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedType, setSelectedType] = useState<'all' | 'Movie' | 'TV Show'>('all');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [selectedRating, setSelectedRating] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'year-desc' | 'year-asc' | 'title-asc' | 'title-desc'>('year-desc');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Selected item for modal
  const [detailItem, setDetailItem] = useState<MovieCityItem | null>(null);

  // Filtered dataset
  const filteredItems = useMemo(() => {
    return filterMovieCityCatalog({
      search: searchTerm,
      type: selectedType,
      genre: selectedGenre,
      rating: selectedRating,
      sortBy,
    });
  }, [searchTerm, selectedType, selectedGenre, selectedRating, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const effectivePage = Math.min(currentPage, totalPages);
  const pageItems = useMemo(() => {
    const start = (effectivePage - 1) * ITEMS_PER_PAGE;
    return filteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredItems, effectivePage]);

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedType('all');
    setSelectedGenre('all');
    setSelectedRating('all');
    setSortBy('year-desc');
    setCurrentPage(1);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(filteredItems, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movie_city_catalog_${filteredItems.length}_titles.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const a = document.createElement('a');
    a.href = '/assets/aistudio/Paste_November_13__2026_-_4_42AM_affd8629';
    a.download = 'movie_city_catalog_1450_titles.csv';
    a.click();
  };

  const handleAdaptInStudio = (item: MovieCityItem) => {
    if (onLoadMovieIntoStudio) {
      const prompt = buildAkzyonAdaptationPrompt(item);
      const scenes = createDefaultScenesFromMovie(item);
      onLoadMovieIntoStudio({
        title: `${item.title} (3!2!1! Akzyon Cut)`,
        prompt,
        scenes,
        director: item.director,
        cast: item.cast,
      });
    }
  };

  return (
    <div
      data-testid="movie-city-catalog-browser"
      className={`space-y-6 bg-[#0c0c0e] text-[#e4e4e7] p-4 sm:p-6 border border-white/10 rounded-2xl ${className}`}
    >
      {/* Header Banner & Stats */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="space-y-1.5 border-l-[3px] border-[#ff3e3e] pl-4">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-[#ff3e3e]">
            <span className="font-bold">MOVIE CITY OFFICIAL STREAMING ARCHIVE</span>
            <span>·</span>
            <span className="text-[#00ff41]">1,450 VERIFIED TITLES LOADED</span>
            <span>·</span>
            <span className="text-[#e4e4e7]/70">DISNEY+ & TEKA-SERYE PIPELINE</span>
          </div>
          <h2 className="text-xl sm:text-3xl font-display font-extrabold uppercase tracking-tight text-white flex items-center gap-2">
            <span>Movie City Catalog & AI Director Explorer</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#e4e4e7]/70 max-w-3xl leading-relaxed">
            Mag-search at mag-browse sa buong 1,450 movies at TV shows. Bawat titulo ay puwedeng i-load sa{' '}
            <strong className="text-amber-300">3!2!1! Akzyon Studio</strong> para sa automated Pinoy teleserye adaptation,
            cinematic frame prompt generation, at live Tagalog dubbing playback.
          </p>
        </div>

        {/* Quick Stats Grid & Export */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 bg-[#141417] border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
            <Film className="w-3.5 h-3.5 text-[#ff3e3e]" />
            <span>{stats.moviesCount} Pelikula</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#141417] border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
            <Tv className="w-3.5 h-3.5 text-[#00ff41]" />
            <span>{stats.tvShowsCount} TV Shows</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#141417] border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>{stats.minYear} – {stats.maxYear}</span>
          </div>
          <button
            type="button"
            onClick={handleDownloadJson}
            className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-lg text-xs font-mono flex items-center gap-1 cursor-pointer"
            title="I-download ang filtered dataset bilang JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSON</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-mono flex items-center gap-1 cursor-pointer"
            title="I-download ang orihinal na 1,450 CSV attachment"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="space-y-3 bg-[#141417] border border-white/10 p-4 rounded-xl">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search Box */}
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-[#e4e4e7]/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Maghanap ng titulo, artista, direktor, o genre (hal. Avengers, Pixar, Star Wars, Comedy)..."
              className="w-full min-h-[42px] bg-[#0c0c0e] border border-white/15 rounded-lg pl-9 pr-3 text-xs sm:text-sm text-white placeholder-[#e4e4e7]/40 focus:outline-none focus:border-[#ff3e3e]"
            />
          </div>

          {/* Type Filter */}
          <div className="md:col-span-2">
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value as any);
                setCurrentPage(1);
              }}
              className="w-full min-h-[42px] bg-[#0c0c0e] border border-white/15 rounded-lg px-2.5 text-xs text-white focus:outline-none focus:border-[#ff3e3e]"
            >
              <option value="all">Lahat ng Uri (All {stats.totalCount})</option>
              <option value="Movie">Pelikula / Movies ({stats.moviesCount})</option>
              <option value="TV Show">TV Shows / Serye ({stats.tvShowsCount})</option>
            </select>
          </div>

          {/* Genre Filter */}
          <div className="md:col-span-2">
            <select
              value={selectedGenre}
              onChange={(e) => {
                setSelectedGenre(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full min-h-[42px] bg-[#0c0c0e] border border-white/15 rounded-lg px-2.5 text-xs text-white focus:outline-none focus:border-[#ff3e3e]"
            >
              <option value="all">Lahat ng Genre ({stats.allGenres.length})</option>
              {stats.allGenres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Rating Filter */}
          <div className="md:col-span-1">
            <select
              value={selectedRating}
              onChange={(e) => {
                setSelectedRating(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full min-h-[42px] bg-[#0c0c0e] border border-white/15 rounded-lg px-2 text-xs text-white focus:outline-none focus:border-[#ff3e3e]"
            >
              <option value="all">Rating (All)</option>
              {stats.allRatings.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div className="md:col-span-2">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as any);
                setCurrentPage(1);
              }}
              className="w-full min-h-[42px] bg-[#0c0c0e] border border-white/15 rounded-lg px-2 text-xs text-white focus:outline-none focus:border-[#ff3e3e]"
            >
              <option value="year-desc">Taon: Pinakabago (2021 &rarr; 1928)</option>
              <option value="year-asc">Taon: Pinakaluma (1928 &rarr; 2021)</option>
              <option value="title-asc">Titulo: A &rarr; Z</option>
              <option value="title-desc">Titulo: Z &rarr; A</option>
            </select>
          </div>
        </div>

        {/* Results summary bar & reset */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5 text-xs text-[#e4e4e7]/70">
          <div>
            <span>
              May <strong className="text-white">{filteredItems.length}</strong> titulo na natagpuan
            </span>
            {searchTerm && <span> para sa &ldquo;{searchTerm}&rdquo;</span>}
            {filteredItems.length !== stats.totalCount && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="ml-3 text-[#ff3e3e] hover:underline font-bold"
              >
                I-reset ang filter
              </button>
            )}
          </div>
          <div className="text-[11px] font-mono text-[#e4e4e7]/50">
            Pahina {effectivePage} ng {totalPages} ({ITEMS_PER_PAGE} bawat pahina)
          </div>
        </div>
      </div>

      {/* Grid of Movie Cards */}
      {filteredItems.length === 0 ? (
        <div className="p-12 text-center bg-[#141417] border border-white/10 rounded-xl space-y-3">
          <Film className="w-10 h-10 text-white/30 mx-auto" />
          <h3 className="text-base font-bold text-white">Walang nahanap na pelikula o palabas</h3>
          <p className="text-xs text-[#e4e4e7]/60">
            Subukang palitan ang search keywords o i-reset ang filter.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-4 py-2 bg-[#ff3e3e] text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            I-reset Lahat
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pageItems.map((item) => {
            const isMovie = item.type === 'Movie';
            return (
              <div
                key={item.id}
                data-testid={`catalog-card-${item.id}`}
                className="bg-[#141417] border border-white/10 hover:border-[#ff3e3e]/60 rounded-xl p-4 flex flex-col justify-between transition-all group space-y-3"
              >
                <div className="space-y-2">
                  {/* Top Badges */}
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span
                      className={`px-2 py-0.5 rounded font-bold uppercase ${
                        isMovie
                          ? 'bg-[#ff3e3e]/20 border border-[#ff3e3e]/40 text-[#ff7878]'
                          : 'bg-[#00ff41]/20 border border-[#00ff41]/40 text-[#00ff41]'
                      }`}
                    >
                      {item.type}
                    </span>
                    <div className="flex items-center gap-1.5 text-[#e4e4e7]/70">
                      {item.rating && (
                        <span className="px-1.5 py-0.5 bg-white/10 rounded font-bold">
                          {item.rating}
                        </span>
                      )}
                      <span>{item.releaseYear || ''}</span>
                    </div>
                  </div>

                  {/* Title */}
                  <h3
                    className="text-base font-display font-extrabold text-white line-clamp-2 group-hover:text-[#ff3e3e] transition-colors"
                    title={item.title}
                  >
                    {item.title}
                  </h3>

                  {/* Duration & Genres */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#e4e4e7]/60">
                    {item.duration && (
                      <span className="flex items-center gap-1 font-mono text-amber-300/80">
                        <Clock className="w-3 h-3" />
                        {item.duration}
                      </span>
                    )}
                    {item.genres.slice(0, 2).map((g) => (
                      <span
                        key={g}
                        className="px-1.5 py-0.2 rounded bg-white/5 border border-white/10 text-[10px]"
                      >
                        {g}
                      </span>
                    ))}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-[#e4e4e7]/70 line-clamp-3 leading-relaxed">
                    {item.description}
                  </p>

                  {/* Director & Cast snippet */}
                  {(item.director || item.cast) && (
                    <div className="text-[10px] font-mono text-[#e4e4e7]/50 truncate pt-1 border-t border-white/5">
                      {item.director ? `Direk: ${item.director}` : `Bida: ${item.cast}`}
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => handleAdaptInStudio(item)}
                    className="min-h-[36px] px-2.5 py-1.5 bg-[#ff3e3e] hover:bg-[#ff3e3e]/90 text-[#0c0c0e] font-display font-extrabold uppercase text-[11px] rounded-lg flex items-center justify-center gap-1 cursor-pointer truncate"
                    title="I-load sa 3!2!1! Akzyon Studio para gumawa ng video adaptation"
                  >
                    <Clapperboard className="w-3.5 h-3.5 shrink-0" />
                    <span>Akzyon Adapt</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailItem(item)}
                    className="min-h-[36px] px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white font-mono text-[11px] rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span>Detalye</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
          <div className="text-xs font-mono text-[#e4e4e7]/60">
            Ipinapakita ang {(effectivePage - 1) * ITEMS_PER_PAGE + 1} –{' '}
            {Math.min(effectivePage * ITEMS_PER_PAGE, filteredItems.length)} ng {filteredItems.length} mga pamagat
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={effectivePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="min-h-[38px] px-3 py-1.5 bg-[#141417] hover:bg-white/10 disabled:opacity-40 border border-white/10 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Nauna</span>
            </button>
            <div className="px-3 py-1.5 bg-[#0c0c0e] border border-white/15 rounded-lg text-xs font-mono font-bold text-white">
              {effectivePage} / {totalPages}
            </div>
            <button
              type="button"
              disabled={effectivePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[38px] px-3 py-1.5 bg-[#141417] hover:bg-white/10 disabled:opacity-40 border border-white/10 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <span>Susunod</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Title Details & AI Adaptation Modal */}
      {detailItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="bg-[#141417] border border-white/20 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 space-y-5 text-[#e4e4e7] relative shadow-2xl">
            <button
              type="button"
              aria-label="Isara ang detalye"
              onClick={() => setDetailItem(null)}
              className="absolute top-4 right-4 p-2 text-[#e4e4e7]/60 hover:text-white rounded-lg bg-white/5 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2 border-l-[3px] border-[#ff3e3e] pl-4 pr-10">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-[#ff3e3e]">
                <span>{detailItem.type}</span>
                <span>·</span>
                <span>{detailItem.rating || 'NR'}</span>
                <span>·</span>
                <span>{detailItem.releaseYear}</span>
                {detailItem.duration && (
                  <>
                    <span>·</span>
                    <span className="text-amber-300">{detailItem.duration}</span>
                  </>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-display font-extrabold uppercase text-white">
                {detailItem.title}
              </h2>
            </div>

            {/* Synopsis */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-mono uppercase tracking-wider text-amber-400 font-bold">
                Buod ng Kwento (Plot / Synopsis):
              </h4>
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed bg-[#0c0c0e] border border-white/10 p-3.5 rounded-xl">
                {detailItem.description}
              </p>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-[#0c0c0e] border border-white/10 p-4 rounded-xl">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Direktor:</span>
                <span className="text-white font-semibold">{detailItem.director || 'Hindi nakasaad'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Bansa:</span>
                <span className="text-white font-semibold">{detailItem.country || 'Hindi nakasaad'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Mga Artista / Cast:</span>
                <span className="text-white font-semibold">{detailItem.cast || 'Hindi nakasaad'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Mga Kategorya / Genres:</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {detailItem.genres.map((g) => (
                    <span
                      key={g}
                      className="px-2 py-0.5 rounded bg-white/10 border border-white/15 text-[11px] text-white"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 3!2!1! Akzyon Adaptation Preview */}
            <div className="space-y-2 bg-gradient-to-r from-[#ff3e3e]/10 to-amber-500/10 border border-[#ff3e3e]/30 p-4 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs font-display font-bold uppercase text-[#ff7878]">
                <Sparkles className="w-4 h-4" />
                <span>3!2!1! Akzyon Automated Adaptation Prompt</span>
              </div>
              <p className="text-xs text-[#e4e4e7]/80 italic">
                &ldquo;{buildAkzyonAdaptationPrompt(detailItem)}&rdquo;
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 border-t border-white/10">
              {onPlayMoviePreview && (
                <button
                  type="button"
                  onClick={() => {
                    onPlayMoviePreview(detailItem.title, detailItem.description);
                    setDetailItem(null);
                  }}
                  className="min-h-[42px] px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/40 border border-emerald-500/50 text-emerald-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>I-play sa Master Player</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  handleAdaptInStudio(detailItem);
                  setDetailItem(null);
                }}
                className="min-h-[42px] px-5 py-2.5 bg-[#ff3e3e] hover:bg-[#ff3e3e]/90 text-[#0c0c0e] font-display font-extrabold uppercase text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                <Clapperboard className="w-4 h-4" />
                <span>Gamitin sa 3!2!1! Akzyon Studio Editor</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MovieCityCatalogBrowser;
