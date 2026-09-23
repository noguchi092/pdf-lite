/* global PDFLib, pdfjsLib, JSZip */
(() => {
  'use strict';

  const { PDFDocument, degrees } = PDFLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  const tools = {
    merge: { title: 'PDFを結合', description: '結合したいPDFを選び、順番を整えて保存します。', multiple: true, drop: '結合するPDFファイルを選択' },
    split: { title: 'PDFを分割', description: 'ページごと、または指定した範囲ごとに分けます。', multiple: false, drop: '分割するPDFファイルを選択' },
    compress: { title: 'PDFを圧縮', description: '画質を選び、画像として再構成して容量を軽くします。', multiple: false, drop: '圧縮するPDFファイルを選択' },
    organize: { title: 'ページを整理', description: 'ページを見ながら、並べ替え・回転・削除ができます。', multiple: false, drop: '整理するPDFファイルを選択' },
    edit: { title: 'PDFを編集', description: '文字の修正・追加、図形、画像、署名をExcelに近い操作で配置できます。', multiple: false, drop: '編集するPDFファイルを選択' }
  };

  const state = { tool: 'merge', files: [], pages: [], splitMode: 'each', compressLevel: 'standard', pdfJsDoc: null,
    editor: { page: 0, annotations: [], textItems: [], activeTool: 'select', color: '#e32929', fontSize: 24, font: 'gothic', opacity: .38, penWidth: 3, shapeFill: 'none', zoom: 1, drawing: false, start: null, draft: null, selected: null, clipboard: null, history: [], future: [], interaction: null } };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const refs = {
    cards: $$('.tool-card'), title: $('#workspace-title'), description: $('#workspace-description'), drop: $('#drop-zone'),
    input: $('#file-input'), dropTitle: $('#drop-title'), content: $('#tool-content'), reset: $('#reset-button'),
    error: $('#error-box'), success: $('#success-box'), processing: $('#processing'), processingMessage: $('#processing-message'), progress: $('#progress-bar')
  };

  refs.cards.forEach(card => card.addEventListener('click', () => selectTool(card.dataset.tool)));
  refs.drop.addEventListener('click', () => refs.input.click());
  refs.drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); refs.input.click(); } });
  refs.input.addEventListener('change', () => acceptFiles([...refs.input.files]));
  ['dragenter', 'dragover'].forEach(type => refs.drop.addEventListener(type, event => { event.preventDefault(); refs.drop.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach(type => refs.drop.addEventListener(type, event => { event.preventDefault(); refs.drop.classList.remove('is-dragging'); }));
  refs.drop.addEventListener('drop', event => acceptFiles([...event.dataTransfer.files]));
  refs.reset.addEventListener('click', resetCurrent);

  function selectTool(tool) {
    if (state.tool === tool) return;
    state.tool = tool;
    resetCurrent();
    refs.cards.forEach(card => { const active = card.dataset.tool === tool; card.classList.toggle('is-active', active); card.setAttribute('aria-pressed', String(active)); });
    const config = tools[tool];
    refs.title.textContent = config.title;
    refs.description.textContent = config.description;
    refs.dropTitle.textContent = config.drop;
    refs.input.multiple = config.multiple;
    refs.drop.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetCurrent(clearMessage = true) {
    state.files = []; state.pages = []; state.pdfJsDoc = null;
    state.editor = { page: 0, annotations: [], textItems: [], activeTool: 'select', color: '#e32929', fontSize: 24, font: 'gothic', opacity: .38, penWidth: 3, shapeFill: 'none', zoom: 1, drawing: false, start: null, draft: null, selected: null, clipboard: null, history: [], future: [], interaction: null };
    refs.input.value = ''; refs.content.innerHTML = ''; refs.drop.classList.remove('hidden'); refs.reset.classList.add('hidden');
    if (clearMessage) clearNotices();
  }

  function clearNotices() { refs.error.classList.add('hidden'); refs.success.classList.add('hidden'); }
  function showError(message) { refs.error.textContent = message; refs.error.classList.remove('hidden'); refs.success.classList.add('hidden'); refs.error.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function showSuccess(message) { refs.success.textContent = message; refs.success.classList.remove('hidden'); refs.error.classList.add('hidden'); }

  async function acceptFiles(incoming) {
    clearNotices();
    const pdfs = incoming.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return showError('PDFファイルを選択してください。');
    if (state.tool === 'merge') state.files.push(...pdfs);
    else state.files = [pdfs[0]];
    refs.input.value = '';
    try {
      if (state.tool === 'organize') await loadOrganizer();
      else if (state.tool === 'edit') await loadEditor();
      else renderTool();
      refs.drop.classList.add('hidden'); refs.reset.classList.remove('hidden');
    } catch (error) { console.error(error); setProcessing(false); showError('PDFを読み込めませんでした。パスワード保護やファイル破損がないか確認してください。'); }
  }

  function renderTool() {
    if (state.tool === 'merge') renderMerge();
    if (state.tool === 'split') renderSplit();
    if (state.tool === 'compress') renderCompress();
  }

  function fileRow(file, index, merge = false) {
    return `<div class="file-row" data-index="${index}">
      <span class="file-badge">PDF</span><span class="file-meta"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
      <span class="row-actions">${merge ? `<button class="icon-button move-up" title="上へ" aria-label="${index + 1}番目のファイルを上へ">↑</button><button class="icon-button move-down" title="下へ" aria-label="${index + 1}番目のファイルを下へ">↓</button>` : ''}<button class="icon-button danger remove-file" title="削除" aria-label="${index + 1}番目のファイルを削除">×</button></span>
    </div>`;
  }

  function renderMerge() {
    refs.content.innerHTML = `<div class="file-list">${state.files.map((f, i) => fileRow(f, i, true)).join('')}</div>
      <button class="add-button" id="add-files" type="button">＋ PDFを追加</button>
      <button class="primary-button" id="run-merge" type="button" ${state.files.length < 2 ? 'disabled' : ''}>${state.files.length < 2 ? 'PDFを2個以上選択してください' : `${state.files.length}個のPDFを結合する`}</button>`;
    bindFileRows(renderMerge);
    $('#add-files').addEventListener('click', () => refs.input.click());
    $('#run-merge').addEventListener('click', mergePdfs);
  }

  function bindFileRows(rerender) {
    $$('.remove-file').forEach(button => button.addEventListener('click', event => { state.files.splice(Number(event.currentTarget.closest('.file-row').dataset.index), 1); if (!state.files.length) resetCurrent(); else rerender(); }));
    $$('.move-up').forEach(button => button.addEventListener('click', event => moveFile(Number(event.currentTarget.closest('.file-row').dataset.index), -1, rerender)));
    $$('.move-down').forEach(button => button.addEventListener('click', event => moveFile(Number(event.currentTarget.closest('.file-row').dataset.index), 1, rerender)));
  }
  function moveFile(index, amount, rerender) { const next = index + amount; if (next < 0 || next >= state.files.length) return; [state.files[index], state.files[next]] = [state.files[next], state.files[index]]; rerender(); }

  async function mergePdfs() {
    setProcessing(true, 'PDFを順番に結合しています');
    try {
      const output = await PDFDocument.create();
      for (let i = 0; i < state.files.length; i++) {
        const source = await PDFDocument.load(await state.files[i].arrayBuffer(), { ignoreEncryption: false });
        const pages = await output.copyPages(source, source.getPageIndices()); pages.forEach(page => output.addPage(page));
        setProgress(((i + 1) / state.files.length) * 90);
      }
      downloadBytes(await output.save({ useObjectStreams: true }), '結合済み.pdf', 'application/pdf');
      showSuccess('結合が完了しました。「結合済み.pdf」を保存しました。');
    } catch (error) { console.error(error); showError('結合できませんでした。パスワード保護されたPDFは利用できません。'); }
    finally { setProcessing(false); }
  }

  function renderSplit() {
    refs.content.innerHTML = `<div class="file-list">${fileRow(state.files[0], 0)}</div>
      <div class="settings"><h3>分割方法</h3><div class="option-grid">
        <div class="option"><input type="radio" id="split-each" name="split-mode" value="each" ${state.splitMode === 'each' ? 'checked' : ''}><label for="split-each"><strong>1ページずつ</strong><small>各ページを別々のPDFにする</small></label></div>
        <div class="option"><input type="radio" id="split-range" name="split-mode" value="range" ${state.splitMode === 'range' ? 'checked' : ''}><label for="split-range"><strong>範囲を指定</strong><small>必要なページをグループ化</small></label></div>
      </div><div id="range-field" class="${state.splitMode === 'range' ? '' : 'hidden'}" style="margin-top:16px"><label class="field-label" for="ranges">1行につき1つのPDFを作成</label><textarea id="ranges" placeholder="1-3&#10;4-6&#10;8,10-12"></textarea><p class="field-help">例：1〜3ページと4〜6ページを別ファイルにする場合は、2行に分けて入力します。</p></div></div>
      <button class="primary-button" id="run-split" type="button">PDFを分割する</button>`;
    bindFileRows(renderSplit);
    $$('input[name="split-mode"]').forEach(input => input.addEventListener('change', event => { state.splitMode = event.target.value; $('#range-field').classList.toggle('hidden', state.splitMode !== 'range'); }));
    $('#run-split').addEventListener('click', splitPdf);
  }

  async function splitPdf() {
    setProcessing(true, '分割するページを準備しています');
    try {
      const source = await PDFDocument.load(await state.files[0].arrayBuffer());
      const count = source.getPageCount();
      let groups;
      if (state.splitMode === 'each') groups = Array.from({ length: count }, (_, i) => [i]);
      else groups = parseRangeGroups($('#ranges').value, count);
      if (!groups.length) throw new Error('範囲を入力してください。');
      const zip = new JSZip();
      for (let i = 0; i < groups.length; i++) {
        const doc = await PDFDocument.create(); const pages = await doc.copyPages(source, groups[i]); pages.forEach(page => doc.addPage(page));
        const label = state.splitMode === 'each' ? `ページ_${String(groups[i][0] + 1).padStart(3, '0')}` : `分割_${String(i + 1).padStart(2, '0')}`;
        zip.file(`${label}.pdf`, await doc.save({ useObjectStreams: true })); setProgress(((i + 1) / groups.length) * 75);
      }
      if (groups.length === 1) {
        const only = zip.file(Object.keys(zip.files)[0]); downloadBlob(await only.async('blob'), '分割済み.pdf');
      } else {
        downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, meta => setProgress(75 + meta.percent * .25)), '分割済みPDF.zip');
      }
      showSuccess(`分割が完了しました。${groups.length}個のPDFを保存しました。`);
    } catch (error) { console.error(error); showError(error.message || 'PDFを分割できませんでした。入力したページ範囲を確認してください。'); }
    finally { setProcessing(false); }
  }

  function parseRangeGroups(text, pageCount) {
    if (!text.trim()) throw new Error('ページ範囲を入力してください。');
    return text.split(/\n+/).filter(Boolean).map(line => {
      const pages = [];
      line.split(',').forEach(part => {
        const value = part.trim(); if (!value) return;
        const match = value.match(/^(\d+)(?:\s*[-〜~]\s*(\d+))?$/); if (!match) throw new Error(`「${value}」の書き方を確認してください。`);
        const start = Number(match[1]); const end = Number(match[2] || match[1]);
        if (start < 1 || end > pageCount || start > end) throw new Error(`ページ範囲は1〜${pageCount}で指定してください。`);
        for (let p = start; p <= end; p++) if (!pages.includes(p - 1)) pages.push(p - 1);
      });
      return pages;
    }).filter(group => group.length);
  }

  function renderCompress() {
    refs.content.innerHTML = `<div class="file-list">${fileRow(state.files[0], 0)}</div>
      <div class="settings"><h3>圧縮レベル</h3><div class="option-grid">
        ${compressOption('strong', '高圧縮', '画質を抑えて小さく')}${compressOption('standard', '標準', '画質と容量のバランス')}${compressOption('quality', '高画質', '画質を優先して圧縮')}
      </div><p class="warning-text">圧縮後はページが画像化されるため、文字検索・コピー・リンク・フォームは失われます。図面や写真中心のPDF向けです。</p></div>
      <button class="primary-button" id="run-compress" type="button">PDFを圧縮する</button>`;
    bindFileRows(renderCompress);
    $$('input[name="compress-level"]').forEach(input => input.addEventListener('change', event => { state.compressLevel = event.target.value; }));
    $('#run-compress').addEventListener('click', compressPdf);
  }
  function compressOption(value, title, help) { return `<div class="option"><input type="radio" id="compress-${value}" name="compress-level" value="${value}" ${state.compressLevel === value ? 'checked' : ''}><label for="compress-${value}"><strong>${title}</strong><small>${help}</small></label></div>`; }

  async function compressPdf() {
    const config = { strong: { scale: .85, quality: .52 }, standard: { scale: 1.15, quality: .68 }, quality: { scale: 1.45, quality: .82 } }[state.compressLevel];
    setProcessing(true, 'ページを圧縮しています');
    try {
      const bytes = new Uint8Array(await state.files[0].arrayBuffer());
      const viewDoc = await pdfjsLib.getDocument({ data: bytes }).promise; const output = await PDFDocument.create();
      for (let n = 1; n <= viewDoc.numPages; n++) {
        const page = await viewDoc.getPage(n); const base = page.getViewport({ scale: 1 }); const render = page.getViewport({ scale: config.scale });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(render.width); canvas.height = Math.ceil(render.height);
        const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: render }).promise;
        const jpeg = await canvasToBytes(canvas, 'image/jpeg', config.quality); const image = await output.embedJpg(jpeg);
        const outPage = output.addPage([base.width, base.height]); outPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
        canvas.width = canvas.height = 1; page.cleanup(); setProgress((n / viewDoc.numPages) * 92);
      }
      const result = await output.save({ useObjectStreams: true }); downloadBytes(result, '圧縮済み.pdf', 'application/pdf');
      const before = state.files[0].size; const change = Math.round((1 - result.length / before) * 100);
      showSuccess(change > 0 ? `圧縮が完了しました。約${change}%小さくなりました（${formatBytes(before)} → ${formatBytes(result.length)}）。` : `処理が完了しました。元のPDFより${formatBytes(result.length - before)}大きくなりました。別の圧縮レベルもお試しください。`);
    } catch (error) { console.error(error); showError('圧縮できませんでした。ページ数やファイル容量が大きい場合は、分割してからお試しください。'); }
    finally { setProcessing(false); }
  }

  async function loadOrganizer() {
    setProcessing(true, 'ページの見本を作成しています');
    const bytes = new Uint8Array(await state.files[0].arrayBuffer()); state.pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    state.pages = Array.from({ length: state.pdfJsDoc.numPages }, (_, i) => ({ sourceIndex: i, rotation: 0, canvas: null }));
    refs.content.innerHTML = `<div class="file-list">${fileRow(state.files[0], 0)}</div><p class="field-help" style="margin-top:16px">カードをドラッグ、または矢印ボタンで並べ替えられます。</p><div class="pages-grid" id="pages-grid"></div><button class="primary-button" id="run-organize" type="button">整理したPDFを保存する</button>`;
    bindFileRows(() => resetCurrent());
    for (let i = 0; i < state.pages.length; i++) { await renderThumbnail(i); setProgress(((i + 1) / state.pages.length) * 90); }
    renderPages(); $('#run-organize').addEventListener('click', organizePdf); setProcessing(false);
  }

  async function renderThumbnail(index) {
    const page = await state.pdfJsDoc.getPage(index + 1); const viewport = page.getViewport({ scale: .34 });
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; state.pages[index].canvas = canvas.toDataURL('image/jpeg', .72); page.cleanup();
  }

  function renderPages() {
    const grid = $('#pages-grid');
    grid.innerHTML = state.pages.map((page, index) => `<article class="page-card" draggable="true" data-index="${index}"><div class="page-preview"><img src="${page.canvas}" draggable="false" alt="元の${page.sourceIndex + 1}ページ目の見本" style="max-width:100%;max-height:100%;transform:rotate(${page.rotation}deg)"></div><span class="page-number">${index + 1}ページ目</span><div class="page-actions"><button data-action="left" title="左へ" aria-label="${index + 1}ページ目を左へ">←</button><button data-action="right" title="右へ" aria-label="${index + 1}ページ目を右へ">→</button><button data-action="rotate" title="右回転" aria-label="${index + 1}ページ目を右に回転">↻</button><button data-action="delete" title="削除" aria-label="${index + 1}ページ目を削除">×</button></div></article>`).join('');
    $$('.page-actions button').forEach(button => button.addEventListener('click', event => pageAction(Number(event.currentTarget.closest('.page-card').dataset.index), event.currentTarget.dataset.action)));
    let dragging = null;
    $$('.page-card').forEach(card => {
      card.addEventListener('dragstart', () => { dragging = Number(card.dataset.index); card.classList.add('is-dragging'); });
      card.addEventListener('dragend', () => { card.classList.remove('is-dragging'); $$('.page-card').forEach(c => c.classList.remove('is-over')); });
      card.addEventListener('dragover', event => { event.preventDefault(); card.classList.add('is-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('is-over'));
      card.addEventListener('drop', event => { event.preventDefault(); const target = Number(card.dataset.index); if (dragging !== null && dragging !== target) { const [item] = state.pages.splice(dragging, 1); state.pages.splice(target, 0, item); renderPages(); } });
    });
  }

  function pageAction(index, action) {
    if (action === 'delete') { if (state.pages.length === 1) return showError('すべてのページは削除できません。'); state.pages.splice(index, 1); }
    if (action === 'rotate') state.pages[index].rotation = (state.pages[index].rotation + 90) % 360;
    if (action === 'left' && index > 0) [state.pages[index - 1], state.pages[index]] = [state.pages[index], state.pages[index - 1]];
    if (action === 'right' && index < state.pages.length - 1) [state.pages[index + 1], state.pages[index]] = [state.pages[index], state.pages[index + 1]];
    renderPages();
  }

  async function organizePdf() {
    setProcessing(true, 'ページを新しい順番で保存しています');
    try {
      const source = await PDFDocument.load(await state.files[0].arrayBuffer()); const output = await PDFDocument.create();
      for (let i = 0; i < state.pages.length; i++) {
        const item = state.pages[i]; const [page] = await output.copyPages(source, [item.sourceIndex]);
        const original = page.getRotation().angle || 0; page.setRotation(degrees((original + item.rotation) % 360)); output.addPage(page); setProgress(((i + 1) / state.pages.length) * 92);
      }
      downloadBytes(await output.save({ useObjectStreams: true }), 'ページ整理済み.pdf', 'application/pdf'); showSuccess('ページ整理が完了しました。「ページ整理済み.pdf」を保存しました。');
    } catch (error) { console.error(error); showError('ページを保存できませんでした。'); }
    finally { setProcessing(false); }
  }

  async function loadEditor() {
    if (window.PdfLiteAdvancedEditor) {
      await window.PdfLiteAdvancedEditor({ state, refs, fileRow, bindFileRows, resetCurrent, setProcessing, showError, showSuccess, PDFDocument, canvasToBytes, downloadBytes });
      return;
    }
    setProcessing(true, '編集画面を準備しています');
    const bytes = new Uint8Array(await state.files[0].arrayBuffer());
    state.pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    state.editor.annotations = Array.from({ length: state.pdfJsDoc.numPages }, () => []);
    refs.content.innerHTML = `<div class="file-list">${fileRow(state.files[0], 0)}</div>
      <div class="editor-shell">
        <div class="editor-toolbar" role="toolbar" aria-label="PDF編集ツール">
          <button class="editor-tool is-selected" data-edit-tool="text" type="button">文字</button>
          <button class="editor-tool" data-edit-tool="pen" type="button">手書き</button>
          <button class="editor-tool" data-edit-tool="highlight" type="button">マーカー</button>
          <button class="editor-undo" id="editor-undo" type="button">↶ 元に戻す</button>
        </div>
        <div class="editor-options" aria-label="編集設定">
          <label class="editor-control">色 <input id="edit-color" type="color" value="#e32929"></label>
          <label class="editor-control" data-editor-setting="text">フォント
            <select id="edit-font"><option value="gothic">ゴシック体</option><option value="mincho">明朝体</option><option value="rounded">丸ゴシック体</option><option value="monospace">等幅フォント</option></select>
          </label>
          <label class="editor-control" data-editor-setting="text">文字サイズ
            <select id="edit-font-size"><option value="12">12</option><option value="16">16</option><option value="20">20</option><option value="24" selected>24</option><option value="32">32</option><option value="40">40</option><option value="48">48</option><option value="64">64</option></select>
          </label>
          <label class="editor-control hidden" data-editor-setting="pen">線の太さ <input id="edit-pen-width" type="range" min="2" max="24" value="5"><output id="pen-width-value">5</output></label>
          <label class="editor-control hidden" data-editor-setting="highlight">不透明度 <input id="edit-opacity" type="range" min="5" max="100" step="5" value="38"><output id="opacity-value">38%</output></label>
        </div>
        <p class="editor-help" id="editor-help">PDF上の文字を入れたい場所をタップしてください。</p>
        <div class="editor-zoom" aria-label="表示倍率"><button id="editor-zoom-out" type="button" aria-label="縮小">−</button><button id="editor-zoom-reset" type="button"><span id="editor-zoom-label">100%</span></button><button id="editor-zoom-in" type="button" aria-label="拡大">＋</button></div>
        <div class="editor-viewport" id="editor-viewport"><div class="editor-stage" id="editor-stage"><canvas id="pdf-canvas"></canvas><canvas id="annotation-canvas"></canvas></div></div>
        <div class="editor-pagination"><button id="editor-prev" type="button">← 前のページ</button><strong id="editor-page-label"></strong><button id="editor-next" type="button">次のページ →</button></div>
      </div>
      <button class="primary-button" id="run-edit" type="button">編集したPDFを保存する</button>`;
    bindFileRows(() => resetCurrent());
    $$('.editor-tool').forEach(button => button.addEventListener('click', () => selectEditorTool(button.dataset.editTool)));
    $('#edit-color').addEventListener('input', event => { state.editor.color = event.target.value; });
    $('#edit-font').addEventListener('change', event => { state.editor.font = event.target.value; });
    $('#edit-font-size').addEventListener('change', event => { state.editor.fontSize = Number(event.target.value); });
    $('#edit-pen-width').addEventListener('input', event => { state.editor.penWidth = Number(event.target.value); $('#pen-width-value').textContent = event.target.value; });
    $('#edit-opacity').addEventListener('input', event => { state.editor.opacity = Number(event.target.value) / 100; $('#opacity-value').textContent = `${event.target.value}%`; });
    $('#editor-undo').addEventListener('click', () => { state.editor.annotations[state.editor.page].pop(); drawAnnotations(); });
    $('#editor-prev').addEventListener('click', () => changeEditorPage(-1));
    $('#editor-next').addEventListener('click', () => changeEditorPage(1));
    $('#editor-zoom-out').addEventListener('click', () => setEditorZoom(state.editor.zoom - .25));
    $('#editor-zoom-reset').addEventListener('click', () => setEditorZoom(1));
    $('#editor-zoom-in').addEventListener('click', () => setEditorZoom(state.editor.zoom + .25));
    $('#run-edit').addEventListener('click', saveEditedPdf);
    bindEditorCanvas();
    await renderEditorPage();
    setProcessing(false);
  }

  function selectEditorTool(tool) {
    state.editor.activeTool = tool;
    $$('.editor-tool').forEach(button => button.classList.toggle('is-selected', button.dataset.editTool === tool));
    $$('[data-editor-setting]').forEach(control => control.classList.toggle('hidden', control.dataset.editorSetting !== tool));
    const help = { text: 'フォントと文字サイズを選び、文字を入れたい場所をタップしてください。', pen: '色と線の太さを選び、PDF上を指やマウスでなぞってください。', highlight: '色と不透明度を選び、塗りたい場所をドラッグしてください。' };
    $('#editor-help').textContent = help[tool];
  }

  async function renderEditorPage() {
    const page = await state.pdfJsDoc.getPage(state.editor.page + 1);
    const stage = $('#editor-stage');
    const base = page.getViewport({ scale: 1 });
    const availableWidth = $('#editor-viewport').clientWidth - 4;
    const baseWidth = Math.min(900, Math.max(280, availableWidth));
    const viewport = page.getViewport({ scale: (baseWidth * state.editor.zoom) / base.width });
    const canvas = $('#pdf-canvas'); const overlay = $('#annotation-canvas');
    canvas.width = overlay.width = Math.ceil(viewport.width); canvas.height = overlay.height = Math.ceil(viewport.height);
    stage.style.width = `${canvas.width}px`; stage.style.height = `${canvas.height}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    page.cleanup(); drawAnnotations();
    $('#editor-page-label').textContent = `${state.editor.page + 1} / ${state.pdfJsDoc.numPages}ページ`;
    $('#editor-prev').disabled = state.editor.page === 0;
    $('#editor-next').disabled = state.editor.page === state.pdfJsDoc.numPages - 1;
    $('#editor-zoom-label').textContent = `${Math.round(state.editor.zoom * 100)}%`;
    $('#editor-zoom-out').disabled = state.editor.zoom <= .5;
    $('#editor-zoom-in').disabled = state.editor.zoom >= 2.5;
  }

  async function setEditorZoom(value) {
    state.editor.zoom = Math.max(.5, Math.min(2.5, Math.round(value * 4) / 4));
    await renderEditorPage();
  }

  function bindEditorCanvas() {
    const canvas = $('#annotation-canvas');
    const point = event => { const rect = canvas.getBoundingClientRect(); const source = event.touches ? event.touches[0] : event; return { x: (source.clientX - rect.left) / rect.width, y: (source.clientY - rect.top) / rect.height }; };
    const start = event => {
      event.preventDefault(); const p = point(event); const tool = state.editor.activeTool;
      if (tool === 'text') { const value = prompt('追加する文字を入力してください'); if (value) { state.editor.annotations[state.editor.page].push({ type: 'text', x: p.x, y: p.y, text: value, color: state.editor.color, size: state.editor.fontSize, font: state.editor.font }); drawAnnotations(); } return; }
      state.editor.drawing = true; state.editor.start = p;
      state.editor.draft = tool === 'pen' ? { type: 'pen', color: state.editor.color, size: state.editor.penWidth, points: [p] } : { type: 'highlight', color: state.editor.color, opacity: state.editor.opacity, x: p.x, y: p.y, w: 0, h: 0 };
    };
    const move = event => { if (!state.editor.drawing) return; event.preventDefault(); const p = point(event); const draft = state.editor.draft; if (draft.type === 'pen') draft.points.push(p); else { draft.x = Math.min(state.editor.start.x, p.x); draft.y = Math.min(state.editor.start.y, p.y); draft.w = Math.abs(p.x - state.editor.start.x); draft.h = Math.abs(p.y - state.editor.start.y); } drawAnnotations(draft); };
    const end = event => { if (!state.editor.drawing) return; event.preventDefault(); state.editor.drawing = false; const draft = state.editor.draft; if (draft.type === 'pen' ? draft.points.length > 1 : draft.w > .003 && draft.h > .003) state.editor.annotations[state.editor.page].push(draft); state.editor.draft = null; drawAnnotations(); };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', end, { passive: false });
  }

  function drawAnnotations(extra = null, target = $('#annotation-canvas')) {
    const ctx = target.getContext('2d'); ctx.clearRect(0, 0, target.width, target.height);
    const items = [...state.editor.annotations[state.editor.page], ...(extra ? [extra] : [])];
    items.forEach(item => drawAnnotation(ctx, item, target.width, target.height));
  }

  function drawAnnotation(ctx, item, width, height) {
    const fonts = { gothic: '"Yu Gothic", "Noto Sans JP", sans-serif', mincho: '"Yu Mincho", "Noto Serif JP", serif', rounded: '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif', monospace: 'monospace' };
    if (item.type === 'text') { ctx.fillStyle = item.color; const renderedSize = Math.max(8, item.size * width / 900); ctx.font = `700 ${renderedSize}px ${fonts[item.font] || fonts.gothic}`; ctx.textBaseline = 'top'; item.text.split('\n').forEach((line, i) => ctx.fillText(line, item.x * width, item.y * height + i * renderedSize * 1.25)); return; }
    if (item.type === 'pen') { ctx.strokeStyle = item.color; ctx.lineWidth = item.size * width / 900; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath(); item.points.forEach((p, i) => i ? ctx.lineTo(p.x * width, p.y * height) : ctx.moveTo(p.x * width, p.y * height)); ctx.stroke(); return; }
    ctx.save(); ctx.globalAlpha = Number.isFinite(item.opacity) ? item.opacity : .38; ctx.fillStyle = item.color || '#ffe100';
    ctx.fillRect(item.x * width, item.y * height, item.w * width, item.h * height); ctx.restore();
  }

  async function changeEditorPage(amount) { const next = state.editor.page + amount; if (next < 0 || next >= state.pdfJsDoc.numPages) return; state.editor.page = next; await renderEditorPage(); }

  async function saveEditedPdf() {
    setProcessing(true, '編集内容をPDFに保存しています');
    try {
      const doc = await PDFDocument.load(await state.files[0].arrayBuffer());
      for (let i = 0; i < doc.getPageCount(); i++) {
        const items = state.editor.annotations[i]; if (!items.length) continue;
        const page = doc.getPage(i); const { width, height } = page.getSize();
        const canvas = document.createElement('canvas'); const scale = Math.min(2, Math.max(1, 1400 / width)); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d'); items.forEach(item => drawAnnotation(ctx, item, canvas.width, canvas.height));
        const png = await doc.embedPng(await canvasToBytes(canvas, 'image/png')); page.drawImage(png, { x: 0, y: 0, width, height });
        canvas.width = canvas.height = 1; setProgress(((i + 1) / doc.getPageCount()) * 92);
      }
      downloadBytes(await doc.save({ useObjectStreams: true }), '編集済み.pdf', 'application/pdf');
      showSuccess('編集が完了しました。「編集済み.pdf」を保存しました。');
    } catch (error) { console.error(error); showError('編集したPDFを保存できませんでした。'); }
    finally { setProcessing(false); }
  }

  function setProcessing(visible, message = '') { refs.processing.classList.toggle('hidden', !visible); refs.processingMessage.textContent = message; setProgress(visible ? 8 : 0); }
  function setProgress(value) { refs.progress.style.width = `${Math.max(0, Math.min(100, value))}%`; }
  function formatBytes(bytes) { if (!Number.isFinite(bytes) || bytes === 0) return '0 KB'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3); return `${(bytes / (1024 ** i)).toFixed(i ? 1 : 0)} ${units[i]}`; }
  function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
  function canvasToBytes(canvas, type, quality) { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? blob.arrayBuffer().then(resolve) : reject(new Error('画像変換に失敗しました。')), type, quality)); }
  function downloadBytes(bytes, name, type) { downloadBlob(new Blob([bytes], { type }), name); }
  function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); }
})();
