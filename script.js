// ══════════════════════════════════════════════════════════════════
//  ACERVO LITERÁRIO — script.js
//  Compatível com Oracle APEX ORDS REST
// ══════════════════════════════════════════════════════════════════

// ── Config ────────────────────────────────────────────────────────
// Substitua pela URL real da sua instância Oracle APEX
const API_URL   = 'https://oracleapex.com/ords/progressao/v1/leituras/';
const METAS_URL = 'https://oracleapex.com/ords/progressao/v1/metas/';

// Chaves de armazenamento local
const NOME_KEY   = 'acervo_nome';
const METAS_KEY  = 'acervo_metas_local';   // fallback quando API de metas falha
const DATA_KEY   = 'acervo_dados_cache';   // cache de leituras para uso offline

// ── Estado global ─────────────────────────────────────────────────
let todasLeituras = [];
let filtroAtivo   = 'todos';
let anoRelatorio  = new Date().getFullYear();
let graficoMensal = null;
let chipCategoria = null;
let carregando    = false;

// ══════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════

/**
 * Normaliza o status retornado pela API para as classes internas.
 * Retorna 'lendo' | 'concluido' | 'pausado' | 'para_iniciar' | 'desconhecido'
 * CORREÇÃO: antes retornava 'lendo' como fallback, escondendo itens
 * cujo status não batia com nenhum filtro.
 */
function getStatusClass(status) {
    const s = (status || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (s.includes('CONCLU') || s.includes('FINALIZ') || s.includes('TERMINA')) return 'concluido';
    if (s.includes('PAUSAD') || s.includes('ESPERA')  || s.includes('INTERROMP')) return 'pausado';
    if (s.includes('INICI')  || s.includes('LISTA')   || s.includes('QUERO') ||
        s.includes('PARA')   || s.includes('FILA')    || s.includes('QUER'))   return 'para_iniciar';
    if (s.includes('LENDO')  || s.includes('LEITURA') || s.includes('ANDAMENTO') ||
        s.includes('ATUAL')  || s.includes('PROGRES')) return 'lendo';
    // Status desconhecido: retorna 'lendo' só quando a string está vazia
    return s.length === 0 ? 'lendo' : 'desconhecido';
}

/** Rótulo legível para cada classe de status */
function statusLabel(cls) {
    return { lendo: 'Lendo', concluido: 'Concluído', pausado: 'Pausado', para_iniciar: 'Para Iniciar', desconhecido: 'Outro' }[cls] || cls;
}

/**
 * Extrai a chave "YYYY-MM" de um item.
 * Usa MES_FIM (data de conclusão) como preferência, com fallback para MES_INICIO.
 */
function getMes(item) {
    const raw = item.MES_FIM   || item.mes_fim   ||
                item.MES_INICIO|| item.mes_inicio || null;
    if (!raw) return null;
    if (/^\d{4}-\d{2}/.test(raw))        return raw.substring(0, 7);
    if (/^\d{2}\/\d{4}$/.test(raw))      { const [m,y]=raw.split('/'); return `${y}-${m.padStart(2,'0')}`; }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)){ const p=raw.split('/'); return `${p[2]}-${p[1].padStart(2,'0')}`; }
    if (/^\d{4}\/\d{2}/.test(raw))        return raw.substring(0,4)+'-'+raw.substring(5,7);
    return null;
}

/** Converte "YYYY-MM" → abreviação do mês em pt-BR */
function nomeMes(chave) {
    const [y, m] = chave.split('-');
    return new Date(+y, +m - 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

/** Lê o valor de campo com suporte a maiúsculas e minúsculas (APEX pode variar) */
function campo(item, ...nomes) {
    for (const n of nomes) {
        if (item[n] !== undefined && item[n] !== null) return item[n];
        const up = n.toUpperCase();
        if (item[up] !== undefined && item[up] !== null) return item[up];
        const lo = n.toLowerCase();
        if (item[lo] !== undefined && item[lo] !== null) return item[lo];
    }
    return undefined;
}

/** Toast de feedback */
let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ══════════════════════════════════════════════════════════════════
//  SAUDAÇÃO DINÂMICA
// ══════════════════════════════════════════════════════════════════
function atualizarSaudacao() {
    const h = new Date().getHours();
    const saudacoes = [
        [5,  12, 'Bom dia 🌅'],
        [12, 18, 'Boa tarde ☀️'],
        [18, 24, 'Boa noite 🌙'],
        [0,   5, 'Boa madrugada 🌙'],
    ];
    const nome = localStorage.getItem(NOME_KEY);
    for (const [ini, fim, texto] of saudacoes) {
        if (h >= ini && h < fim) {
            document.getElementById('greeting-text').textContent =
                nome ? `${texto.split(' ').slice(0, 2).join(' ')}, ${nome.split(' ')[0]}!` : texto;
            break;
        }
    }
}

// ══════════════════════════════════════════════════════════════════
//  FETCH DADOS
// ══════════════════════════════════════════════════════════════════
async function carregarLeituras() {
    if (carregando) return;
    carregando = true;
    const container = document.getElementById('reading-list');

    // Exibe skeletons
    container.innerHTML = `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>`;

    try {
        const res = await fetch(API_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // APEX ORDS retorna { items: [...] } ou diretamente o array
        todasLeituras = Array.isArray(data) ? data : (data.items || []);

        // Salva cache local
        try { localStorage.setItem(DATA_KEY, JSON.stringify(todasLeituras)); } catch(_) {}

        if (!todasLeituras.length) {
            container.innerHTML = `<p class='empty-msg'><span class='em-icon'>📚</span>Nenhuma leitura encontrada.<br>Use o botão <strong>+</strong> para adicionar.</p>`;
            return;
        }

        renderizarCards(todasLeituras);
        atualizarAvatar();
        atualizarSaudacao();

    } catch (err) {
        console.error('Erro ao carregar leituras:', err);

        // Tenta usar cache local
        const cache = localStorage.getItem(DATA_KEY);
        if (cache) {
            try {
                todasLeituras = JSON.parse(cache);
                renderizarCards(todasLeituras);
                atualizarAvatar();
                showToast('Exibindo dados em cache (offline)', 'error');
                return;
            } catch(_) {}
        }

        container.innerHTML = `
            <p class='empty-msg' style='color:var(--danger)'>
                <span class='em-icon'>⚠️</span>
                Erro de conexão.<br>
                <small style='color:var(--text-sub)'>${err.message}</small>
            </p>`;
    } finally {
        carregando = false;
    }
}

// ══════════════════════════════════════════════════════════════════
//  RENDERIZAR CARDS
// ══════════════════════════════════════════════════════════════════
function renderizarCards(lista) {
    const container = document.getElementById('reading-list');

    if (!lista.length) {
        container.innerHTML = `<p class='empty-msg'><span class='em-icon'>🔍</span>Nenhum livro nesta categoria.</p>`;
        return;
    }

    container.innerHTML = lista.map((item, i) => {
        const livro  = campo(item, 'LIVRO', 'livro', 'TITULO', 'titulo', 'TITLE') || 'Sem título';
        const autor  = campo(item, 'AUTOR', 'autor', 'AUTHOR') || '';
        const cat    = campo(item, 'CATEGORIA', 'categoria', 'CATEGORY') || 'Geral';
        const status = campo(item, 'STATUS', 'status') || 'Lendo';
        const capaRaw= campo(item, 'CAPA_URL', 'capa_url', 'COVER_URL', 'cover_url', 'IMAGEM', 'imagem') || '';
        const capa   = capaRaw || `https://placehold.co/68x96/1a1e2b/7880a0?text=📖`;

        const atual  = parseInt(campo(item, 'PAGINA_ATUAL', 'pagina_atual', 'CURRENT_PAGE')) || 0;
        const total  = parseInt(campo(item, 'TOTAL_PAGINAS', 'total_paginas', 'TOTAL_PAGES', 'NUM_PAGES')) || 0;
        const perc   = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
        const cls    = getStatusClass(status);
        const label  = statusLabel(cls);

        const mesInicio = campo(item, 'MES_INICIO', 'mes_inicio') || '';
        const subLine   = [autor, cat, mesInicio].filter(Boolean).join(' · ');

        return `
        <div class="card" style="animation-delay:${Math.min(i * 0.04, 0.5)}s" data-id="${campo(item,'ID','id') || i}">
            <img src="${capa}" class="cover" alt="Capa de ${livro}" loading="lazy"
                 onerror="this.src='https://placehold.co/68x96/1a1e2b/7880a0?text=📖'">
            <div class="info">
                <h3 title="${livro}">${livro}</h3>
                <p class="sub-line" title="${subLine}">${subLine || '&nbsp;'}</p>
                <div class="progress-bar">
                    <div class="progress-fill ${cls}" style="width:${perc}%"></div>
                </div>
                <div class="status-row">
                    <span>${total > 0 ? `${perc}% · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} pgs` : 'Sem paginação'}</span>
                    <span class="status-label ${cls}">${label}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════════════════
//  FILTROS
// ══════════════════════════════════════════════════════════════════
function aplicarFiltro(filtro) {
    filtroAtivo = filtro;

    // CORREÇÃO: 'todos' mostra tudo; outros filtros incluem 'desconhecido'
    // somente se o filtro for 'lendo' (fallback natural)
    const lista = filtro === 'todos'
        ? todasLeituras
        : todasLeituras.filter(i => {
            const cls = getStatusClass(campo(i,'STATUS','status') || '');
            if (filtro === 'lendo') return cls === 'lendo' || cls === 'desconhecido';
            return cls === filtro;
          });

    renderizarCards(lista);
}

document.querySelectorAll('.categories button').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.categories button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        aplicarFiltro(this.dataset.filter);
    });
});

// ══════════════════════════════════════════════════════════════════
//  EXPLORAR
// ══════════════════════════════════════════════════════════════════
function renderizarExplorar() {
    const statusInfo = [
        { key: 'lendo',        label: 'Em leitura'  },
        { key: 'concluido',    label: 'Concluídos'  },
        { key: 'pausado',      label: 'Pausados'    },
        { key: 'para_iniciar', label: 'Para iniciar'},
    ];

    const grid = document.getElementById('status-grid');
    grid.innerHTML = statusInfo.map(s => {
        const count = todasLeituras.filter(i => {
            const cls = getStatusClass(campo(i,'STATUS','status') || '');
            if (s.key === 'lendo') return cls === 'lendo' || cls === 'desconhecido';
            return cls === s.key;
        }).length;
        return `
        <div class="explore-status-card ${s.key}" data-filter="${s.key}" role="button" tabindex="0">
            <span class="esc-count">${count}</span>
            <span class="esc-label">${s.label}</span>
        </div>`;
    }).join('');

    grid.querySelectorAll('.explore-status-card').forEach(card => {
        const go = () => {
            navegarPara('home');
            aplicarFiltro(card.dataset.filter);
            document.querySelectorAll('.categories button').forEach(b => {
                b.classList.toggle('active', b.dataset.filter === card.dataset.filter);
            });
        };
        card.addEventListener('click', go);
        card.addEventListener('keydown', e => e.key === 'Enter' && go());
    });

    // Chips de categoria
    const cats = [...new Set(
        todasLeituras.map(i => campo(i,'CATEGORIA','categoria') || 'Geral').filter(Boolean)
    )].sort();

    const chipsEl = document.getElementById('category-chips');
    chipsEl.innerHTML = cats.map(c => `<span class="chip" data-cat="${c}" tabindex="0">${c}</span>`).join('');

    // Atualiza datalist do modal de adicionar
    const dl = document.getElementById('cat-suggestions');
    if (dl) dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');

    chipsEl.querySelectorAll('.chip').forEach(chip => {
        const toggle = function () {
            const ativo = this.classList.contains('active-chip');
            chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active-chip'));
            chipCategoria = ativo ? null : this.dataset.cat;
            if (!ativo) this.classList.add('active-chip');
            filtrarExplorar(document.getElementById('search-input').value);
        };
        chip.addEventListener('click', toggle);
        chip.addEventListener('keydown', e => e.key === 'Enter' && toggle.call(chip));
    });

    filtrarExplorar('');
}

function filtrarExplorar(query) {
    const q = (query || '').toLowerCase().trim();
    let lista = [...todasLeituras];

    if (chipCategoria) lista = lista.filter(i => (campo(i,'CATEGORIA','categoria') || 'Geral') === chipCategoria);
    if (q) lista = lista.filter(i =>
        (campo(i,'LIVRO','livro','TITULO','titulo') || '').toLowerCase().includes(q) ||
        (campo(i,'AUTOR','autor') || '').toLowerCase().includes(q) ||
        (campo(i,'CATEGORIA','categoria') || '').toLowerCase().includes(q)
    );

    const el = document.getElementById('explore-results');
    if (!lista.length) {
        el.innerHTML = `<p class='empty-msg'><span class='em-icon'>🔍</span>Nenhum resultado encontrado.</p>`;
        return;
    }
    el.innerHTML = lista.map((item, i) => {
        const livro  = campo(item,'LIVRO','livro','TITULO','titulo') || 'Sem título';
        const autor  = campo(item,'AUTOR','autor') || '';
        const cat    = campo(item,'CATEGORIA','categoria') || 'Geral';
        const status = campo(item,'STATUS','status') || 'Lendo';
        const capaRaw= campo(item,'CAPA_URL','capa_url','COVER_URL','cover_url') || '';
        const capa   = capaRaw || `https://placehold.co/68x96/1a1e2b/7880a0?text=📖`;
        const atual  = parseInt(campo(item,'PAGINA_ATUAL','pagina_atual')) || 0;
        const total  = parseInt(campo(item,'TOTAL_PAGINAS','total_paginas')) || 0;
        const perc   = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
        const cls    = getStatusClass(status);
        const label  = statusLabel(cls);
        return `
        <div class="card" style="animation-delay:${Math.min(i*0.03,0.4)}s">
            <img src="${capa}" class="cover" alt="${livro}" loading="lazy"
                 onerror="this.src='https://placehold.co/68x96/1a1e2b/7880a0?text=📖'">
            <div class="info">
                <h3 title="${livro}">${livro}</h3>
                <p class="sub-line">${[autor, cat].filter(Boolean).join(' · ')}</p>
                <div class="progress-bar">
                    <div class="progress-fill ${cls}" style="width:${perc}%"></div>
                </div>
                <div class="status-row">
                    <span>${total > 0 ? `${perc}% · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} pgs` : 'Sem paginação'}</span>
                    <span class="status-label ${cls}">${label}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

document.getElementById('search-input').addEventListener('input', e => {
    const val = e.target.value;
    document.getElementById('search-clear').style.display = val ? 'block' : 'none';
    filtrarExplorar(val);
});
document.getElementById('search-clear').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').style.display = 'none';
    filtrarExplorar('');
});

// ══════════════════════════════════════════════════════════════════
//  RELATÓRIO
// ══════════════════════════════════════════════════════════════════
async function renderizarRelatorio() {
    const ano = anoRelatorio;
    document.getElementById('year-label').textContent    = ano;
    document.getElementById('chart-year-badge').textContent = ano;

    // ── Filtrar itens do ano ──────────────────────────────────────
    // Usa MES_FIM para concluídos, MES_INICIO como fallback
    const doAno = todasLeituras.filter(i => {
        const mes = getMes(i);
        return mes && mes.startsWith(String(ano));
    });

    // ── Métricas ─────────────────────────────────────────────────
    const todos       = todasLeituras;
    const concluidos  = todos.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'concluido');
    const emLeitura   = todos.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo').length;
    const pausados    = todos.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'pausado').length;

    // CORREÇÃO: páginas lidas = soma de PAGINA_ATUAL (progresso real)
    // para calcular total de páginas lidas pelo usuário
    const paginasLidas = todos.reduce((acc, i) => {
        const cls = getStatusClass(campo(i,'STATUS','status') || '');
        // Concluídos: soma TOTAL_PAGINAS; em andamento: soma PAGINA_ATUAL
        if (cls === 'concluido') return acc + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0);
        return acc + (parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0);
    }, 0);

    // Páginas lidas no ano (concluídos do ano × total págs + em andamento se mes_inicio no ano)
    const paginasAno = doAno.reduce((acc, i) => {
        const cls = getStatusClass(campo(i,'STATUS','status') || '');
        if (cls === 'concluido') return acc + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0);
        return acc + (parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0);
    }, 0);

    const concluidosAno = doAno.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'concluido');

    // ── Stats grid ───────────────────────────────────────────────
    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card">
            <h4>Concluídos ${ano}</h4>
            <p style="color:var(--success)">${concluidosAno.length}</p>
        </div>
        <div class="stat-card">
            <h4>Em leitura</h4>
            <p style="color:var(--primary)">${emLeitura}</p>
        </div>
        <div class="stat-card">
            <h4>Páginas em ${ano}</h4>
            <p>${paginasAno.toLocaleString('pt-BR')}</p>
        </div>
        <div class="stat-card">
            <h4>Pausados</h4>
            <p style="color:var(--warning)">${pausados}</p>
        </div>
        <div class="stat-card stat-full">
            <h4>Total de páginas lidas</h4>
            <p>${paginasLidas.toLocaleString('pt-BR')}</p>
            <p class="stat-sub">${todos.length} livros no acervo · ${concluidos.length} concluídos</p>
        </div>`;

    // ── Meta anual ───────────────────────────────────────────────
    await carregarMeta(ano, concluidos.length);

    // ── Gráfico mensal ───────────────────────────────────────────
    // CORREÇÃO: considera somente itens concluídos no ano por MES_FIM
    const meses = {};
    for (let m = 1; m <= 12; m++) {
        meses[`${ano}-${String(m).padStart(2, '0')}`] = 0;
    }

    concluidos.forEach(i => {
        const mes = getMes(i);
        if (mes && mes.startsWith(String(ano)) && meses[mes] !== undefined) {
            meses[mes] += parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0;
        }
    });
    // Também adiciona leituras em andamento iniciadas no ano
    todasLeituras
        .filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo')
        .forEach(i => {
            const mesBruto = campo(i,'MES_INICIO','mes_inicio') || '';
            const mes = getMes({ MES_FIM: null, MES_INICIO: mesBruto, mes_inicio: mesBruto });
            if (mes && mes.startsWith(String(ano)) && meses[mes] !== undefined) {
                meses[mes] += parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0;
            }
        });

    const labels  = Object.keys(meses).map(nomeMes);
    const valores  = Object.values(meses);
    const maxVal   = Math.max(...valores, 1);

    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (graficoMensal) graficoMensal.destroy();

    graficoMensal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: valores,
                backgroundColor: valores.map(v => v > 0 ? 'rgba(91,141,238,0.7)' : 'rgba(91,141,238,0.1)'),
                borderColor:     valores.map(v => v > 0 ? '#5b8dee' : 'transparent'),
                borderWidth: 1,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1e2b',
                    borderColor: '#252938',
                    borderWidth: 1,
                    titleColor: '#7880a0',
                    bodyColor: '#e6e9f4',
                    callbacks: {
                        title: items => nomeMes(Object.keys(meses)[items[0].dataIndex]) + ` ${ano}`,
                        label: c => c.parsed.y > 0
                            ? ` ${c.parsed.y.toLocaleString('pt-BR')} páginas`
                            : ' Sem páginas registradas'
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#252938', drawBorder: false },
                    ticks: { color: '#7880a0', font: { family: 'DM Sans', size: 10 } }
                },
                y: {
                    grid: { color: '#252938', drawBorder: false },
                    ticks: {
                        color: '#7880a0',
                        font: { family: 'DM Sans', size: 10 },
                        callback: v => v >= 1000 ? (v/1000).toFixed(0)+'k' : v
                    },
                    beginAtZero: true,
                    suggestedMax: maxVal * 1.15
                }
            }
        }
    });

    // ── Top livros (concluídos, maiores em páginas) ──────────────
    const top = [...concluidos]
        .sort((a, b) => (parseInt(campo(b,'TOTAL_PAGINAS','total_paginas')) || 0) -
                        (parseInt(campo(a,'TOTAL_PAGINAS','total_paginas')) || 0))
        .slice(0, 5);
    const maxPags = parseInt(campo(top[0],'TOTAL_PAGINAS','total_paginas')) || 1;
    const rankClasses = ['gold', 'silver', 'bronze', '', ''];

    document.getElementById('top-books').innerHTML = top.length
        ? top.map((item, i) => {
            const nome = campo(item,'LIVRO','livro','TITULO','titulo') || 'Sem título';
            const pags = parseInt(campo(item,'TOTAL_PAGINAS','total_paginas')) || 0;
            const pct  = Math.round((pags / maxPags) * 100);
            return `
            <div class="top-book-row">
                <span class="top-rank ${rankClasses[i]}">${i + 1}</span>
                <div class="top-book-info">
                    <div class="tbname">${nome}</div>
                    <div class="tbpages">${pags.toLocaleString('pt-BR')} páginas</div>
                    <div class="top-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>`;
          }).join('')
        : `<p class='empty-msg' style='margin-top:10px'>Nenhum livro concluído ainda.</p>`;

    // ── Distribuição por categoria ───────────────────────────────
    const catMap = {};
    todasLeituras.forEach(i => {
        const c = campo(i,'CATEGORIA','categoria') || 'Geral';
        catMap[c] = (catMap[c] || 0) + 1;
    });
    const catArr = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0, 8);
    const maxCat = catArr[0]?.[1] || 1;

    document.getElementById('category-dist').innerHTML = catArr.length
        ? catArr.map(([nome, cnt]) => `
            <div class="cat-dist-row">
                <span class="cat-dist-name">${nome}</span>
                <div class="cat-dist-bar-wrap">
                    <div class="cat-dist-bar" style="width:${Math.round(cnt/maxCat*100)}%"></div>
                </div>
                <span class="cat-dist-count">${cnt}</span>
            </div>`).join('')
        : `<p class='empty-msg' style='margin-top:10px'>Sem dados de categoria.</p>`;
}

// ══════════════════════════════════════════════════════════════════
//  META ANUAL
// ══════════════════════════════════════════════════════════════════
async function carregarMeta(ano, concluidosTotal) {
    let valorMeta = 12;

    // 1) Tenta buscar da API
    try {
        const res  = await fetch(METAS_URL, { cache: 'no-cache' });
        if (res.ok) {
            const data  = await res.json();
            const metas = Array.isArray(data) ? data : (data.items || []);
            const metaAno = metas.find(m => +campo(m,'ANO','ano') === ano &&
                                           !campo(m,'MES','mes'));
            if (metaAno) valorMeta = +(campo(metaAno,'VALOR_META','valor_meta') || 12);
        }
    } catch (_) {}

    // 2) Fallback: localStorage
    try {
        const local = JSON.parse(localStorage.getItem(METAS_KEY) || '{}');
        if (local[ano]) valorMeta = local[ano];
    } catch(_) {}

    // Atualiza UI
    const pct = Math.min(100, Math.round((concluidosTotal / valorMeta) * 100));
    const circumference = 2 * Math.PI * 34;
    const offset = circumference * (1 - pct / 100);

    document.getElementById('meta-concluidos').textContent          = concluidosTotal;
    document.getElementById('meta-total').textContent               = valorMeta;
    document.getElementById('meta-ring-fill').style.strokeDashoffset= offset;
    document.getElementById('meta-ring-pct').textContent            = pct + '%';
    document.getElementById('modal-ano').textContent                = ano;
    document.getElementById('modal-meta-input').value               = valorMeta;

    const restam = Math.max(0, valorMeta - concluidosTotal);
    document.getElementById('meta-sub-text').textContent =
        pct >= 100 ? '🎉 Meta alcançada!' : `Faltam ${restam} livro${restam !== 1 ? 's' : ''}`;
}

// Modal editar meta
document.getElementById('meta-edit-btn').addEventListener('click', () => {
    document.getElementById('modal-meta').style.display = 'flex';
});
document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-meta').style.display = 'none';
});
document.getElementById('modal-save').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('modal-meta-input').value);
    if (!val || val < 1) return;

    // Salva localmente sempre (fallback)
    try {
        const local = JSON.parse(localStorage.getItem(METAS_KEY) || '{}');
        local[anoRelatorio] = val;
        localStorage.setItem(METAS_KEY, JSON.stringify(local));
    } catch(_) {}

    // Tenta salvar na API
    try {
        const res   = await fetch(METAS_URL, { cache: 'no-cache' });
        if (res.ok) {
            const data  = await res.json();
            const metas = Array.isArray(data) ? data : (data.items || []);
            const exist = metas.find(m => +campo(m,'ANO','ano') === anoRelatorio && !campo(m,'MES','mes'));
            const payload = JSON.stringify({ ANO: anoRelatorio, TIPO: 'LIVROS', VALOR_META: val });
            if (exist) {
                const id = campo(exist,'ID','id');
                await fetch(`${METAS_URL}${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: payload });
            } else {
                await fetch(METAS_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: payload });
            }
        }
    } catch(_) {}

    document.getElementById('modal-meta').style.display = 'none';
    showToast('Meta atualizada!', 'success');
    renderizarRelatorio();
});

// Seletor de ano
document.getElementById('year-prev').addEventListener('click', () => { anoRelatorio--; renderizarRelatorio(); });
document.getElementById('year-next').addEventListener('click', () => {
    if (anoRelatorio < new Date().getFullYear()) { anoRelatorio++; renderizarRelatorio(); }
});

// ══════════════════════════════════════════════════════════════════
//  MODAL ADICIONAR LIVRO
// ══════════════════════════════════════════════════════════════════
let statusSelecionado = 'Lendo';

function abrirModalAdd() {
    // Reset form
    ['add-titulo','add-autor','add-total-pags','add-pag-atual','add-categoria','add-capa']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('add-error').style.display = 'none';
    document.getElementById('add-save-text').style.display = '';
    document.getElementById('add-save-loader').style.display = 'none';

    // Status padrão
    statusSelecionado = 'Lendo';
    document.querySelectorAll('.status-opt').forEach(b => {
        b.classList.toggle('selected', b.dataset.val === 'Lendo');
    });

    document.getElementById('modal-add').style.display = 'flex';
    setTimeout(() => document.getElementById('add-titulo')?.focus(), 100);
}

document.getElementById('nav-add-btn').addEventListener('click', abrirModalAdd);

document.querySelectorAll('.status-opt').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.status-opt').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        statusSelecionado = this.dataset.val;
    });
});

function fecharModalAdd() {
    document.getElementById('modal-add').style.display = 'none';
}
document.getElementById('modal-add-close').addEventListener('click', fecharModalAdd);
document.getElementById('modal-add-cancel').addEventListener('click', fecharModalAdd);

// Fechar modal clicando no overlay
document.getElementById('modal-add').addEventListener('click', function(e) {
    if (e.target === this) fecharModalAdd();
});
document.getElementById('modal-meta').addEventListener('click', function(e) {
    if (e.target === this) document.getElementById('modal-meta').style.display = 'none';
});

document.getElementById('modal-add-save').addEventListener('click', async () => {
    const titulo   = document.getElementById('add-titulo').value.trim();
    const autor    = document.getElementById('add-autor').value.trim();
    const totalPgs = parseInt(document.getElementById('add-total-pags').value) || 0;
    const pagAtual = parseInt(document.getElementById('add-pag-atual').value) || 0;
    const cat      = document.getElementById('add-categoria').value.trim() || 'Geral';
    const capa     = document.getElementById('add-capa').value.trim();
    const errEl    = document.getElementById('add-error');

    if (!titulo) {
        errEl.textContent = 'O título é obrigatório.';
        errEl.style.display = 'block';
        document.getElementById('add-titulo').focus();
        return;
    }
    if (pagAtual > totalPgs && totalPgs > 0) {
        errEl.textContent = 'A página atual não pode ser maior que o total de páginas.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    document.getElementById('add-save-text').style.display = 'none';
    document.getElementById('add-save-loader').style.display = '';

    const payload = {
        LIVRO:         titulo,
        AUTOR:         autor,
        TOTAL_PAGINAS: totalPgs,
        PAGINA_ATUAL:  pagAtual,
        CATEGORIA:     cat,
        STATUS:        statusSelecionado,
        CAPA_URL:      capa,
        MES_INICIO:    new Date().toISOString().substring(0,7)
    };

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        fecharModalAdd();
        showToast(`"${titulo}" adicionado!`, 'success');
        await carregarLeituras();
        // Atualizar Explorar se estiver visível
        if (document.getElementById('page-explore').classList.contains('active')) renderizarExplorar();

    } catch (err) {
        document.getElementById('add-save-text').style.display = '';
        document.getElementById('add-save-loader').style.display = 'none';
        errEl.textContent = `Erro ao salvar: ${err.message}`;
        errEl.style.display = 'block';
    }
});

// ══════════════════════════════════════════════════════════════════
//  PERFIL
// ══════════════════════════════════════════════════════════════════
function atualizarAvatar() {
    const nome = localStorage.getItem(NOME_KEY) || '';
    const iniciais = nome
        ? nome.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase()
        : '?';
    document.getElementById('avatar-initials').textContent      = iniciais;
    document.getElementById('profile-avatar-big').textContent   = iniciais;
    document.getElementById('profile-name-display').textContent = nome || 'Leitor';
    atualizarSaudacao();
}

function renderizarPerfil() {
    atualizarAvatar();

    const concluidos   = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'concluido');
    const emLeitura    = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo').length;
    const pausados     = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'pausado').length;
    const paginasConcl = concluidos.reduce((a,i) => a + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0), 0);
    const paginasAtuais= todasLeituras
        .filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo')
        .reduce((a,i) => a + (parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0), 0);
    const totalPagsLidas = paginasConcl + paginasAtuais;
    const mediaPages   = concluidos.length > 0 ? Math.round(paginasConcl / concluidos.length) : 0;
    const categorias   = new Set(todasLeituras.map(i => campo(i,'CATEGORIA','categoria')).filter(Boolean)).size;

    document.getElementById('profile-stats').innerHTML = [
        { label: 'Livros no acervo',        val: todasLeituras.length },
        { label: 'Livros concluídos',        val: concluidos.length },
        { label: 'Em leitura agora',         val: emLeitura },
        { label: 'Pausados',                 val: pausados },
        { label: 'Total de páginas lidas',   val: totalPagsLidas.toLocaleString('pt-BR') },
        { label: 'Média de págs / livro',    val: mediaPages.toLocaleString('pt-BR') },
        { label: 'Categorias diferentes',    val: categorias },
    ].map(r => `
        <div class="ps-row">
            <span class="ps-label">${r.label}</span>
            <span class="ps-val">${r.val}</span>
        </div>`).join('');

    // Badges
    const BADGES = [
        { icon:'📖', name:'Primeira leitura',   desc:'Adicionou o 1º livro',         earned: todasLeituras.length >= 1 },
        { icon:'✅', name:'Leitor dedicado',     desc:'Concluiu 1 livro',             earned: concluidos.length >= 1 },
        { icon:'🔥', name:'Em chamas',           desc:'5 livros concluídos',          earned: concluidos.length >= 5 },
        { icon:'💯', name:'Centenário',          desc:'10 livros concluídos',         earned: concluidos.length >= 10 },
        { icon:'📚', name:'Biblioteca viva',     desc:'20 livros no acervo',          earned: todasLeituras.length >= 20 },
        { icon:'🗺️', name:'Explorador',          desc:'3 categorias diferentes',      earned: categorias >= 3 },
        { icon:'📄', name:'Milhar de páginas',   desc:'1.000 páginas lidas',          earned: totalPagsLidas >= 1000 },
        { icon:'🏆', name:'Maratonista',         desc:'10.000 páginas lidas',         earned: totalPagsLidas >= 10000 },
        { icon:'🌟', name:'Lendário',            desc:'50 livros concluídos',         earned: concluidos.length >= 50 },
    ];

    document.getElementById('badges-grid').innerHTML = BADGES.map(b => `
        <div class="badge-card ${b.earned ? 'earned' : 'locked'}" title="${b.desc}">
            <span class="badge-icon">${b.icon}</span>
            <span class="badge-name">${b.name}</span>
            <span class="badge-desc">${b.desc}</span>
        </div>`).join('');
}

// Editar nome
document.getElementById('edit-name-btn').addEventListener('click', () => {
    const wrap = document.getElementById('profile-edit-wrap');
    const mostrar = wrap.style.display === 'none';
    wrap.style.display = mostrar ? 'flex' : 'none';
    if (mostrar) {
        document.getElementById('profile-name-input').value = localStorage.getItem(NOME_KEY) || '';
        document.getElementById('profile-name-input').focus();
    }
});
document.getElementById('save-name-btn').addEventListener('click', () => {
    const nome = document.getElementById('profile-name-input').value.trim();
    if (nome) {
        localStorage.setItem(NOME_KEY, nome);
        document.getElementById('profile-edit-wrap').style.display = 'none';
        atualizarAvatar();
        showToast('Nome salvo!', 'success');
    }
});
document.getElementById('profile-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('save-name-btn').click();
});

// Atalho: avatar → perfil
document.getElementById('open-profile-btn').addEventListener('click', () => navegarPara('profile'));

// ══════════════════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════════
function navegarPara(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item[data-page]').forEach(n => {
        n.classList.toggle('active', n.dataset.page === page);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === 'report')  renderizarRelatorio();
    if (page === 'profile') renderizarPerfil();
    if (page === 'explore') renderizarExplorar();
}

document.querySelectorAll('.nav-item').forEach(item => {
    const handler = function() {
        const page = this.dataset.page;
        if (!page || page === 'add') return;
        navegarPara(page);
    };
    item.addEventListener('click', handler);
    item.addEventListener('keydown', function(e) { if (e.key === 'Enter') handler.call(this); });
});

// ══════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════
atualizarAvatar();
atualizarSaudacao();
carregarLeituras();
