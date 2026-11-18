import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVIE_CITY_CATALOG,
  filterMovieCityCatalog,
  getCatalogStats,
  buildAkzyonAdaptationPrompt,
  createDefaultScenesFromMovie,
  MovieCityItem,
} from './movieCityCatalog';

test('Movie City Catalog pure logic & adaptation functions', async (t) => {
  await t.test('loads exactly 1,450 titles with expected schema fields', () => {
    assert.equal(MOVIE_CITY_CATALOG.length, 1450, 'Catalog should contain exactly 1,450 titles');

    const first = MOVIE_CITY_CATALOG[0];
    assert.equal(first.id, 's1');
    assert.ok(first.title.length > 0);
    assert.ok(first.type === 'Movie' || first.type === 'TV Show');
    assert.ok(first.description.length > 0);
    assert.ok(Array.isArray(first.genres));

    const last = MOVIE_CITY_CATALOG[1449];
    assert.equal(last.id, 's1450');
    assert.ok(last.title.length > 0);
  });

  await t.test('computes accurate catalog stats', () => {
    const stats = getCatalogStats();
    assert.equal(stats.totalCount, 1450);
    assert.ok(stats.moviesCount > 900, 'Should have majority movies');
    assert.ok(stats.tvShowsCount > 300, 'Should have substantial TV shows');
    assert.equal(stats.moviesCount + stats.tvShowsCount, 1450);
    assert.equal(stats.minYear, 1928, 'Steamboat Willie era begins at 1928');
    assert.equal(stats.maxYear, 2021);
    assert.ok(stats.allGenres.length > 0);
    assert.ok(stats.allRatings.length > 0);
  });

  await t.test('filters items accurately by search query, type, genre, and rating', () => {
    // Search test
    const duckSearch = filterMovieCityCatalog({ search: 'DuckTales' });
    assert.ok(duckSearch.length >= 1);
    assert.ok(duckSearch.some((m) => m.title.includes('DuckTales')));

    // Type filter test
    const moviesOnly = filterMovieCityCatalog({ type: 'Movie' });
    assert.ok(moviesOnly.every((m) => m.type === 'Movie'));

    const tvOnly = filterMovieCityCatalog({ type: 'TV Show' });
    assert.ok(tvOnly.every((m) => m.type === 'TV Show'));

    // Genre filter test
    const actionList = filterMovieCityCatalog({ genre: 'action-adventure' });
    assert.ok(actionList.length > 0);
    assert.ok(actionList.every((m) => m.genres.some((g) => g.toLowerCase().includes('action-adventure'))));

    // Sort order test
    const sortedDesc = filterMovieCityCatalog({ sortBy: 'year-desc' });
    for (let i = 1; i < Math.min(20, sortedDesc.length); i++) {
      assert.ok(sortedDesc[i - 1].releaseYear >= sortedDesc[i].releaseYear);
    }
  });

  await t.test('builds Filipino 3!2!1! Akzyon teleserye adaptation prompt', () => {
    const sampleItem: MovieCityItem = {
      id: 's1',
      type: 'Movie',
      title: 'DuckTales the Movie: Treasure of the Lost Lamp',
      director: 'Bob Hathcock',
      cast: 'Alan Young, Russi Taylor, Richard Libertini',
      country: 'United States',
      dateAdded: 'November 12, 2019',
      releaseYear: 1990,
      rating: 'G',
      duration: '74 min',
      genres: ['Action-Adventure', 'Animation', 'Comedy'],
      description: 'Clever Scrooge McDuck searches for a legendary genie lamp in ancient tombs.',
    };

    const prompt = buildAkzyonAdaptationPrompt(sampleItem);
    assert.ok(prompt.includes('3!2!1! Akzyon Pinoy Teleserye Adaptation'));
    assert.ok(prompt.includes(sampleItem.title));
    assert.ok(prompt.includes(sampleItem.description));
  });

  await t.test('creates 3 complete storyboard drama scenes from any movie item', () => {
    const sampleItem: MovieCityItem = {
      id: 's99',
      type: 'Movie',
      title: 'The Avengers',
      director: 'Joss Whedon',
      cast: 'Robert Downey Jr., Chris Evans, Mark Ruffalo',
      country: 'United States',
      dateAdded: 'November 12, 2019',
      releaseYear: 2012,
      rating: 'PG-13',
      duration: '143 min',
      genres: ['Action-Adventure', 'Sci-Fi'],
      description: 'Earth mightiest heroes assemble to save Manila from an alien fleet.',
    };

    const scenes = createDefaultScenesFromMovie(sampleItem);
    assert.equal(scenes.length, 3, 'Should generate 3 scenes (Simula, Gitna, Kasukdulan)');
    assert.equal(scenes[0].order, 1);
    assert.equal(scenes[1].order, 2);
    assert.equal(scenes[2].order, 3);
    assert.ok(scenes[0].title.includes(sampleItem.title));
    assert.ok(scenes[0].thumbnailDataUrl.length > 0);
    assert.equal(scenes[0].status, 'ready');
  });
});
