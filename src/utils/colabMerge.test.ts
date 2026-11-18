import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SHARED_COLAB_DRIVE_ID,
  SHARED_COLAB_NOTEBOOK_URL,
  LATEST_COLAB_TUNNEL_URL,
  LTX_COLAB_RENDERED_VIDEO_URL,
  buildFixedLtxColabScript,
  buildFixedLtxColabNotebookJson,
} from './dramaStudioLogic';

test('Merged Google Colab LTX-Video 2B v0.9.5 Notebook & Rendered MP4 Asset', async (t) => {
  await t.test('extracts and persists the real 73-frame T4 MP4 render to public/media/ltx-colab-render.mp4', () => {
    const mp4Path = path.resolve(process.cwd(), 'public/media/ltx-colab-render.mp4');
    assert.ok(fs.existsSync(mp4Path), 'public/media/ltx-colab-render.mp4 must exist');
    const stat = fs.statSync(mp4Path);
    assert.ok(stat.size > 300_000, `Expected >300KB MP4 from Colab Cell 2 output, got ${stat.size}`);
    const header = fs.readFileSync(mp4Path).subarray(4, 8).toString('ascii');
    assert.equal(header, 'ftyp', 'MP4 file must have valid ISO Media ftyp header');
    assert.equal(LTX_COLAB_RENDERED_VIDEO_URL, '/media/ltx-colab-render.mp4');
  });

  await t.test('merges public/ltx_video_2b_colab.ipynb with fixes and preserved Cell 2 output', () => {
    const nbPath = path.resolve(process.cwd(), 'public/ltx_video_2b_colab.ipynb');
    assert.ok(fs.existsSync(nbPath), 'public/ltx_video_2b_colab.ipynb must exist');
    const nb = JSON.parse(fs.readFileSync(nbPath, 'utf-8'));
    assert.equal(nb.cells.length, 3, 'Merged notebook should contain 3 cells (Markdown, Cell 1, Cell 2)');

    const cell1Source = nb.cells[1].source.join('');
    assert.ok(!cell1Source.includes('|| !pip'), 'Must not contain bash syntax error || !pip');
    assert.ok(cell1Source.includes('gemini-2.5-flash'), 'Must use gemini-2.5-flash instead of retired gemini-1.5-flash');
    assert.ok(cell1Source.includes('mc-colab-bridge-2026'), 'Must support Movie City default bridge token');

    const cell2Outputs = JSON.stringify(nb.cells[2].outputs || []);
    assert.ok(
      cell2Outputs.includes(LATEST_COLAB_TUNNEL_URL),
      'Preserved Cell 2 output should include the active TryCloudflare tunnel URL'
    );
    assert.ok(
      cell2Outputs.includes('data:video/mp4;base64,'),
      'Preserved Cell 2 output should include the embedded LTX-Video 2B MP4 render'
    );
  });

  await t.test('generates synced Colab Python script and .ipynb JSON', () => {
    const script = buildFixedLtxColabScript();
    assert.ok(script.includes(SHARED_COLAB_NOTEBOOK_URL));
    assert.ok(script.includes(SHARED_COLAB_DRIVE_ID));
    assert.ok(script.includes('gemini-2.5-flash'));
    assert.ok(script.includes('"bridgeToken": bridge_token'));

    const ipynbRaw = buildFixedLtxColabNotebookJson();
    const ipynb = JSON.parse(ipynbRaw);
    assert.equal(ipynb.cells.length, 3);
    assert.ok(JSON.stringify(ipynb.cells[0].source).includes(LATEST_COLAB_TUNNEL_URL));
  });
});
