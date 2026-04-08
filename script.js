// ══════════════════════════════════════════════════════════════════
//  ACERVO LITERÁRIO — script.js  (v3 — corrigido)
//
//  Estrutura real da tabela PROGRESSAO_LEITURA:
//  ID, LIVRO, CATEGORIA, TOTAL_PAGINAS, PAGINA_ATUAL,
//  MES_INICIO, MES_FIM, STATUS, CAPA_URL
//
//  Valores reais de STATUS no banco:
//  'Concluído' | 'Em andamento' | 'Para Iniciar' | 'Pausado'
//
//  CORREÇÕES NESTA VERSÃO:
//  1. APEX ORDS pagina em 25 por padrão → fetchTodosRegistros() itera páginas
//  2. Tabela não tem coluna AUTOR → removidas todas as referências
//  3. getStatusClass() mapeado para os valores exatos do banco
//  4. statusLabel() exibe o rótuSSlo original do banco no card
//  5. getMes() corrige parsing de datas null vindas como string 'null'
// ══════════════════════════════════════════════════════════════════

// ── Config ────────────────────────────────────────────────────────
const API_URL   = 'https://oracleapex.com/ords/progressao/v1/leituras/leituras/';
const METAS_URL = 'https://oracleapex.com/ords/progressao/v1/metas/';

const APEX_LIMIT = 500;      // Busca até 500 registros por página

const NOME_KEY  = 'acervo_nome';
const METAS_KEY = 'acervo_metas_local';
const DATA_KEY  = 'acervo_dados_cache';

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
 * Mapeia o STATUS exato do banco para uma classe CSS interna.
 *
 * Valores do banco:
 *   'Concluído'    → 'concluido'
 *   'Em andamento' → 'lendo'
 *   'Para Iniciar' → 'para_iniciar'
 *   'Pausado'      → 'pausado'
 */
function getStatusClass(status) {
    const s = (status || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    if (s.includes('CONCLU') || s.includes('FINALIZ') || s.includes('TERMINA'))
        return 'concluido';

    if (s.includes('PAUSAD') || s.includes('INTERROMP'))
        return 'pausado';

    // 'PARA INICIAR' — verifica antes de checar 'PARA' sozinho
    if (s.includes('PARA INICI') || s.includes('A INICIAR') || s === 'PARA INICIAR')
        return 'para_iniciar';

    // 'EM ANDAMENTO', 'LENDO', 'EM LEITURA'
    if (s.includes('ANDAMENTO') || s.includes('LENDO') || s.includes('LEITURA') ||
        s.includes('PROGRES')   || s.includes('ATUAL'))
        return 'lendo';

    return s.length === 0 ? 'lendo' : 'desconhecido';
}

/** Rótulo legível para exibição no card (usa o valor real do banco) */
function statusLabel(cls, statusOriginal) {
    const map = {
        lendo:        'Em andamento',
        concluido:    'Concluído',
        pausado:      'Pausado',
        para_iniciar: 'Para Iniciar',
        desconhecido: statusOriginal || 'Outro'
    };
    return map[cls] || statusOriginal || cls;
}

/**
 * Extrai "YYYY-MM" de um item.
 * Prioriza MES_FIM; fallback para MES_INICIO.
 * Aceita: YYYY-MM, YYYY-MM-DD, MM/YYYY, DD/MM/YYYY
 */
function getMes(item) {
    const raw = (
        item.MES_FIM    || item.mes_fim    ||
        item.MES_INICIO || item.mes_inicio || ''
    ).toString().trim();

    if (!raw || raw === 'null' || raw === 'undefined') return null;

    if (/^\d{4}-\d{2}/.test(raw))          return raw.substring(0, 7);
    if (/^\d{2}\/\d{4}$/.test(raw)) {
        const [m, y] = raw.split('/');
        return `${y}-${m.padStart(2, '0')}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
        const p = raw.split('/');
        return `${p[2]}-${p[1].padStart(2, '0')}`;
    }
    if (/^\d{4}\/\d{2}/.test(raw))
        return `${raw.substring(0,4)}-${raw.substring(5,7)}`;

    return null;
}

/** Converte "YYYY-MM" → abreviação do mês em pt-BR */
function nomeMes(chave) {
    const [y, m] = chave.split('-');
    return new Date(+y, +m - 1)
        .toLocaleDateString('pt-BR', { month: 'short' })
        .replace('.', '');
}

/**
 * Lê um campo do objeto com suporte a MAIÚSCULAS e minúsculas.
 * APEX ORDS retorna campos em minúsculas por padrão, mas pode variar.
 */
function campo(item, ...nomes) {
    for (const n of nomes) {
        if (item[n]             !== undefined && item[n]             !== null && item[n]             !== '') return item[n];
        if (item[n.toUpperCase()] !== undefined && item[n.toUpperCase()] !== null && item[n.toUpperCase()] !== '') return item[n.toUpperCase()];
        if (item[n.toLowerCase()] !== undefined && item[n.toLowerCase()] !== null && item[n.toLowerCase()] !== '') return item[n.toLowerCase()];
    }
    return undefined;
}

/** Toast de feedback */
let _toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = `toast ${type} show`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ══════════════════════════════════════════════════════════════════
//  SAUDAÇÃO DINÂMICA
// ══════════════════════════════════════════════════════════════════
function atualizarSaudacao() {
    const h = new Date().getHours();
    const base = h < 5 ? 'Boa madrugada 🌙'
               : h < 12 ? 'Bom dia 🌅'
               : h < 18 ? 'Boa tarde ☀️'
               : 'Boa noite 🌙';
    const primeiroNome = (localStorage.getItem(NOME_KEY) || '').split(' ')[0];
    const el = document.getElementById('greeting-text');
    if (el) el.textContent = primeiroNome
        ? base.replace(/[🌙🌅☀️]/u, '').trim() + `, ${primeiroNome}! ` + (base.match(/[🌙🌅☀️]/u)?.[0] || '')
        : base;
}

// ══════════════════════════════════════════════════════════════════
//  FETCH COMPLETO — itera paginação do APEX ORDS
// ══════════════════════════════════════════════════════════════════

/**
 * BUG CORRIGIDO: APEX ORDS retorna apenas 25 registros por padrão.
 * Esta função busca TODOS os registros iterando as páginas.
 *
 * Resposta ORDS: { items: [], hasMore: bool, limit: N, offset: N, links: [{rel:'next', href:'...'}] }
 */
async function fetchTodosRegistros(baseUrl) {
    let todos    = [];
    let nextUrl  = `${baseUrl}?limit=${APEX_LIMIT}&offset=0`;
    let tentativa = 0;
    const MAX_TENTATIVAS = 20; // segurança contra loop infinito

    while (nextUrl && tentativa < MAX_TENTATIVAS) {
        tentativa++;
        const res = await fetch(nextUrl, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data  = await res.json();
        const itens = Array.isArray(data) ? data : (data.items || []);
        todos = todos.concat(itens);

        console.log(`[Acervo] Página ${tentativa}: ${itens.length} itens (total acumulado: ${todos.length})`);

        if (data.hasMore === true || data.hasMore === 'true') {
            // Tenta usar o link 'next' do ORDS
            const linkNext = (data.links || []).find(l => l.rel === 'next');
            nextUrl = linkNext?.href
                   || `${baseUrl}?limit=${APEX_LIMIT}&offset=${(data.offset || 0) + (data.limit || APEX_LIMIT)}`;
        } else {
            nextUrl = null;
        }
    }

    return todos;
}

async function carregarLeituras() {
    if (carregando) return;
    carregando = true;

    const container = document.getElementById('reading-list');
    container.innerHTML = `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>`;

    try {
        todasLeituras = await fetchTodosRegistros(API_URL);

        // Cache local
        try { localStorage.setItem(DATA_KEY, JSON.stringify(todasLeituras)); } catch(_) {}

        if (!todasLeituras.length) {
            container.innerHTML = `<p class='empty-msg'>
                <span class='em-icon'>📚</span>
                Nenhuma leitura encontrada.<br>Use <strong>+</strong> para adicionar.
            </p>`;
            return;
        }

        renderizarCards(todasLeituras);
        atualizarAvatar();
        atualizarSaudacao();

        // Log de diagnóstico no console
        const porStatus = {};
        todasLeituras.forEach(i => {
            const s = campo(i,'STATUS','status') || '(vazio)';
            porStatus[s] = (porStatus[s] || 0) + 1;
        });
        console.log(`[Acervo] Total carregado: ${todasLeituras.length} livros`);
        console.table(porStatus);

    } catch (err) {
        console.error('[Acervo] Erro:', err);
        try {
            const cache = localStorage.getItem(DATA_KEY);
            if (cache) {
                todasLeituras = JSON.parse(cache);
                if (todasLeituras.length) {
                    renderizarCards(todasLeituras);
                    atualizarAvatar();
                    showToast('Offline — dados em cache', 'error');
                    return;
                }
            }
        } catch(_) {}

        container.innerHTML = `<p class='empty-msg' style='color:var(--danger)'>
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
        container.innerHTML = `<p class='empty-msg'>
            <span class='em-icon'>🔍</span>Nenhum livro nesta categoria.
        </p>`;
        return;
    }

    container.innerHTML = lista.map((item, i) => {
        // Campos exatos da tabela PROGRESSAO_LEITURA (sem AUTOR)
        const livro     = campo(item,'LIVRO','livro')                           || 'Sem título';
        const cat       = campo(item,'CATEGORIA','categoria')                   || 'Geral';
        const statusRaw = campo(item,'STATUS','status')                         || '';
        const capaRaw   = campo(item,'CAPA_URL','capa_url')                     || '';
        const atual     = parseInt(campo(item,'PAGINA_ATUAL','pagina_atual'))   || 0;
        const total     = parseInt(campo(item,'TOTAL_PAGINAS','total_paginas')) || 0;
        const mesInicio = campo(item,'MES_INICIO','mes_inicio')                 || '';
        const mesFim    = campo(item,'MES_FIM','mes_fim')                       || '';

        const capa  = capaRaw || 'https://placehold.co/68x96/1a1e2b/7880a0?text=📖';
        const perc  = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
        const cls   = getStatusClass(statusRaw);
        const label = statusLabel(cls, statusRaw);

        const mesExibir = (mesFim && mesFim !== 'null') ? mesFim
                        : (mesInicio && mesInicio !== 'null') ? mesInicio : '';
        const subLine   = [cat, mesExibir].filter(Boolean).join(' · ');
        const progTexto = total > 0
            ? `${perc}% · ${atual.toLocaleString('pt-BR')} / ${total.toLocaleString('pt-BR')} pgs`
            : 'Sem paginação';

        return `
        <div class="card" style="animation-delay:${Math.min(i * 0.04, 0.6)}s"
             data-id="${campo(item,'ID','id') || i}">
            <img src="${capa}"
                 class="cover"
                 alt="Capa: ${livro.replace(/"/g,'&quot;')}"
                 loading="lazy"
                 onerror="this.src='https://placehold.co/68x96/1a1e2b/7880a0?text=📖'">
            <div class="info">
                <h3 title="${livro.replace(/"/g,'&quot;')}">${livro}</h3>
                <p class="sub-line">${subLine || '&nbsp;'}</p>
                <div class="progress-bar">
                    <div class="progress-fill ${cls}" style="width:${perc}%"></div>
                </div>
                <div class="status-row">
                    <span>${progTexto}</span>
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
        { key: 'lendo',        label: 'Em andamento' },
        { key: 'concluido',    label: 'Concluídos'   },
        { key: 'pausado',      label: 'Pausados'     },
        { key: 'para_iniciar', label: 'Para iniciar' },
    ];

    const grid = document.getElementById('status-grid');
    grid.innerHTML = statusInfo.map(s => {
        const count = todasLeituras.filter(i => {
            const cls = getStatusClass(campo(i,'STATUS','status') || '');
            return s.key === 'lendo' ? (cls === 'lendo' || cls === 'desconhecido') : cls === s.key;
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
            document.querySelectorAll('.categories button').forEach(b =>
                b.classList.toggle('active', b.dataset.filter === card.dataset.filter)
            );
        };
        card.addEventListener('click', go);
        card.addEventListener('keydown', e => e.key === 'Enter' && go());
    });

    const cats = [...new Set(
        todasLeituras.map(i => campo(i,'CATEGORIA','categoria') || 'Geral').filter(Boolean)
    )].sort((a,b) => a.localeCompare(b,'pt-BR'));

    const chipsEl = document.getElementById('category-chips');
    chipsEl.innerHTML = cats.map(c =>
        `<span class="chip" data-cat="${c}" tabindex="0">${c}</span>`
    ).join('');

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

    if (chipCategoria)
        lista = lista.filter(i => (campo(i,'CATEGORIA','categoria') || 'Geral') === chipCategoria);
    if (q)
        lista = lista.filter(i =>
            (campo(i,'LIVRO','livro') || '').toLowerCase().includes(q) ||
            (campo(i,'CATEGORIA','categoria') || '').toLowerCase().includes(q) ||
            (campo(i,'STATUS','status') || '').toLowerCase().includes(q)
        );

    const el = document.getElementById('explore-results');
    if (!lista.length) {
        el.innerHTML = `<p class='empty-msg'>
            <span class='em-icon'>🔍</span>Nenhum resultado encontrado.
        </p>`;
        return;
    }

    el.innerHTML = lista.map((item, i) => {
        const livro    = campo(item,'LIVRO','livro')           || 'Sem título';
        const cat      = campo(item,'CATEGORIA','categoria')   || 'Geral';
        const statusRaw= campo(item,'STATUS','status')         || '';
        const capaRaw  = campo(item,'CAPA_URL','capa_url')     || '';
        const capa     = capaRaw || 'https://placehold.co/68x96/1a1e2b/7880a0?text=📖';
        const atual    = parseInt(campo(item,'PAGINA_ATUAL','pagina_atual'))   || 0;
        const total    = parseInt(campo(item,'TOTAL_PAGINAS','total_paginas')) || 0;
        const perc     = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
        const cls      = getStatusClass(statusRaw);
        const label    = statusLabel(cls, statusRaw);

        return `
        <div class="card" style="animation-delay:${Math.min(i*0.03,0.4)}s">
            <img src="${capa}" class="cover" alt="${livro.replace(/"/g,'&quot;')}" loading="lazy"
                 onerror="this.src='https://placehold.co/68x96/1a1e2b/7880a0?text=📖'">
            <div class="info">
                <h3 title="${livro.replace(/"/g,'&quot;')}">${livro}</h3>
                <p class="sub-line">${cat}</p>
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
    document.getElementById('year-label').textContent       = ano;
    document.getElementById('chart-year-badge').textContent = ano;

    const concluidos = todasLeituras.filter(i =>
        getStatusClass(campo(i,'STATUS','status') || '') === 'concluido'
    );
    const emLeitura = todasLeituras.filter(i =>
        getStatusClass(campo(i,'STATUS','status') || '') === 'lendo'
    ).length;
    const pausados = todasLeituras.filter(i =>
        getStatusClass(campo(i,'STATUS','status') || '') === 'pausado'
    ).length;

    // Concluídos no ano (por MES_FIM)
    const concluidosAno = concluidos.filter(i => {
        const mesFim = campo(i,'MES_FIM','mes_fim');
        const mes    = getMes({ MES_FIM: mesFim, MES_INICIO: null });
        return mes && mes.startsWith(String(ano));
    });

    // Páginas lidas total
    const paginasConcl    = concluidos.reduce((a,i) => a + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0), 0);
    const paginasAndamento= todasLeituras
        .filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo')
        .reduce((a,i) => a + (parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0), 0);
    const totalPagsLidas  = paginasConcl + paginasAndamento;

    const paginasAno = concluidosAno.reduce((a,i) =>
        a + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0), 0);

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card">
            <h4>Concluídos em ${ano}</h4>
            <p style="color:var(--success)">${concluidosAno.length}</p>
        </div>
        <div class="stat-card">
            <h4>Em andamento</h4>
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
            <p>${totalPagsLidas.toLocaleString('pt-BR')}</p>
            <p class="stat-sub">${todasLeituras.length} livros · ${concluidos.length} concluídos</p>
        </div>`;

    await carregarMeta(ano, concluidos.length);

    // Gráfico: concluídos por MES_FIM + em andamento por MES_INICIO
    const meses = {};
    for (let m = 1; m <= 12; m++)
        meses[`${ano}-${String(m).padStart(2,'0')}`] = 0;

    concluidos.forEach(i => {
        const mes = getMes({ MES_FIM: campo(i,'MES_FIM','mes_fim'), MES_INICIO: null });
        if (mes && mes.startsWith(String(ano)) && meses[mes] !== undefined)
            meses[mes] += parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0;
    });
    todasLeituras
        .filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo')
        .forEach(i => {
            const mes = getMes({ MES_FIM: null, MES_INICIO: campo(i,'MES_INICIO','mes_inicio') });
            if (mes && mes.startsWith(String(ano)) && meses[mes] !== undefined)
                meses[mes] += parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0;
        });

    const labels  = Object.keys(meses).map(nomeMes);
    const valores = Object.values(meses);
    const maxVal  = Math.max(...valores, 1);

    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (graficoMensal) graficoMensal.destroy();

    graficoMensal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: valores,
                backgroundColor: valores.map(v => v > 0 ? 'rgba(91,141,238,0.72)' : 'rgba(91,141,238,0.10)'),
                borderColor:     valores.map(v => v > 0 ? '#5b8dee' : 'transparent'),
                borderWidth: 1,
                borderRadius: 7,
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
                    padding: 10,
                    callbacks: {
                        title: items => nomeMes(Object.keys(meses)[items[0].dataIndex]) + ` ${ano}`,
                        label: c => c.parsed.y > 0
                            ? ` ${c.parsed.y.toLocaleString('pt-BR')} páginas`
                            : ' Sem registros'
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
                        callback: v => v >= 1000 ? (v/1000).toFixed(1).replace('.0','')+'k' : v
                    },
                    beginAtZero: true,
                    suggestedMax: maxVal * 1.2
                }
            }
        }
    });

    // Top 5 livros maiores
    const top = [...concluidos]
        .sort((a,b) =>
            (parseInt(campo(b,'TOTAL_PAGINAS','total_paginas')) || 0) -
            (parseInt(campo(a,'TOTAL_PAGINAS','total_paginas')) || 0)
        )
        .slice(0, 5);
    const maxPags = parseInt(campo(top[0],'TOTAL_PAGINAS','total_paginas')) || 1;
    const rankCls = ['gold', 'silver', 'bronze', '', ''];

    document.getElementById('top-books').innerHTML = top.length
        ? top.map((item, i) => {
            const nome = campo(item,'LIVRO','livro') || 'Sem título';
            const pags = parseInt(campo(item,'TOTAL_PAGINAS','total_paginas')) || 0;
            return `
            <div class="top-book-row">
                <span class="top-rank ${rankCls[i]}">${i+1}</span>
                <div class="top-book-info">
                    <div class="tbname">${nome}</div>
                    <div class="tbpages">${pags.toLocaleString('pt-BR')} páginas</div>
                    <div class="top-bar-fill" style="width:${Math.round(pags/maxPags*100)}%"></div>
                </div>
            </div>`;
          }).join('')
        : `<p class='empty-msg' style='margin-top:10px'>Nenhum livro concluído ainda.</p>`;

    // Distribuição por categoria
    const catMap = {};
    todasLeituras.forEach(i => {
        const c = campo(i,'CATEGORIA','categoria') || 'Geral';
        catMap[c] = (catMap[c] || 0) + 1;
    });
    const catArr = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
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

    try {
        const local = JSON.parse(localStorage.getItem(METAS_KEY) || '{}');
        if (local[ano]) valorMeta = local[ano];
    } catch(_) {}

    try {
        const res = await fetch(`${METAS_URL}?limit=100`, { cache: 'no-cache' });
        if (res.ok) {
            const data  = await res.json();
            const metas = Array.isArray(data) ? data : (data.items || []);
            const metaAno = metas.find(m =>
                parseInt(campo(m,'ANO','ano')) === ano && !campo(m,'MES','mes')
            );
            if (metaAno) valorMeta = +(campo(metaAno,'VALOR_META','valor_meta') || 12);
        }
    } catch(_) {}

    const pct    = Math.min(100, Math.round((concluidosTotal / valorMeta) * 100));
    const circ   = 2 * Math.PI * 34;
    const offset = circ * (1 - pct / 100);

    document.getElementById('meta-concluidos').textContent             = concluidosTotal;
    document.getElementById('meta-total').textContent                  = valorMeta;
    document.getElementById('meta-ring-fill').style.strokeDashoffset   = offset;
    document.getElementById('meta-ring-pct').textContent               = pct + '%';
    document.getElementById('modal-ano').textContent                   = ano;
    document.getElementById('modal-meta-input').value                  = valorMeta;

    const restam = Math.max(0, valorMeta - concluidosTotal);
    const subEl  = document.getElementById('meta-sub-text');
    if (subEl) subEl.textContent = pct >= 100
        ? '🎉 Meta alcançada!'
        : `Faltam ${restam} livro${restam !== 1 ? 's' : ''}`;
}

document.getElementById('meta-edit-btn').addEventListener('click', () => {
    document.getElementById('modal-meta').style.display = 'flex';
});
document.getElementById('modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-meta').style.display = 'none';
});
document.getElementById('modal-save').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('modal-meta-input').value);
    if (!val || val < 1) { showToast('Informe um valor válido', 'error'); return; }

    try {
        const local = JSON.parse(localStorage.getItem(METAS_KEY) || '{}');
        local[anoRelatorio] = val;
        localStorage.setItem(METAS_KEY, JSON.stringify(local));
    } catch(_) {}

    try {
        const res   = await fetch(`${METAS_URL}?limit=100`, { cache: 'no-cache' });
        if (res.ok) {
            const data  = await res.json();
            const metas = Array.isArray(data) ? data : (data.items || []);
            const exist = metas.find(m =>
                parseInt(campo(m,'ANO','ano')) === anoRelatorio && !campo(m,'MES','mes')
            );
            const payload = JSON.stringify({ ANO: anoRelatorio, TIPO: 'LIVROS', VALOR_META: val });
            const id = exist && campo(exist,'ID','id');
            if (id) {
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

document.getElementById('year-prev').addEventListener('click', () => { anoRelatorio--; renderizarRelatorio(); });
document.getElementById('year-next').addEventListener('click', () => {
    if (anoRelatorio < new Date().getFullYear()) { anoRelatorio++; renderizarRelatorio(); }
});

// ══════════════════════════════════════════════════════════════════
//  MODAL ADICIONAR LIVRO
// ══════════════════════════════════════════════════════════════════
// Valores exatos que serão gravados no banco
const STATUS_VALORES_BANCO = {
    'Em andamento': 'Em andamento',
    'Para Iniciar': 'Para Iniciar',
    'Pausado':      'Pausado',
    'Concluído':    'Concluído'
};
let statusSelecionado = 'Em andamento';

function abrirModalAdd() {
    ['add-titulo','add-total-pags','add-pag-atual','add-categoria','add-capa']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const errEl = document.getElementById('add-error');
    if (errEl) errEl.style.display = 'none';
    document.getElementById('add-save-text').style.display   = '';
    document.getElementById('add-save-loader').style.display = 'none';
    statusSelecionado = 'Em andamento';
    document.querySelectorAll('.status-opt').forEach(b =>
        b.classList.toggle('selected', b.dataset.val === 'Em andamento')
    );
    document.getElementById('modal-add').style.display = 'flex';
    setTimeout(() => document.getElementById('add-titulo')?.focus(), 120);
}

document.getElementById('nav-add-btn').addEventListener('click', abrirModalAdd);

document.querySelectorAll('.status-opt').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.status-opt').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        statusSelecionado = this.dataset.val;
    });
});

function fecharModalAdd() { document.getElementById('modal-add').style.display = 'none'; }
document.getElementById('modal-add-close').addEventListener('click', fecharModalAdd);
document.getElementById('modal-add-cancel').addEventListener('click', fecharModalAdd);

['modal-add','modal-meta'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
        if (e.target === this) this.style.display = 'none';
    });
});

document.getElementById('modal-add-save').addEventListener('click', async () => {
    const titulo   = document.getElementById('add-titulo').value.trim();
    const totalPgs = parseInt(document.getElementById('add-total-pags').value) || 0;
    const pagAtual = parseInt(document.getElementById('add-pag-atual').value)  || 0;
    const cat      = document.getElementById('add-categoria').value.trim()     || 'Geral';
    const capa     = document.getElementById('add-capa').value.trim();
    const errEl    = document.getElementById('add-error');

    if (!titulo) {
        errEl.textContent = '⚠️ O título é obrigatório.';
        errEl.style.display = 'block';
        document.getElementById('add-titulo').focus();
        return;
    }
    if (totalPgs > 0 && pagAtual > totalPgs) {
        errEl.textContent = '⚠️ Página atual não pode ser maior que o total.';
        errEl.style.display = 'block';
        return;
    }
    errEl.style.display = 'none';
    document.getElementById('add-save-text').style.display   = 'none';
    document.getElementById('add-save-loader').style.display = '';

    const mesAtual  = new Date().toISOString().substring(0, 7);
    const statusVal = STATUS_VALORES_BANCO[statusSelecionado] || statusSelecionado;

    // Payload com nomes exatos das colunas da tabela
    const payload = {
        LIVRO:         titulo,
        CATEGORIA:     cat,
        TOTAL_PAGINAS: totalPgs,
        PAGINA_ATUAL:  pagAtual,
        STATUS:        statusVal,
        MES_INICIO:    mesAtual,
        MES_FIM:       statusVal === 'Concluído' ? mesAtual : null,
        CAPA_URL:      capa || null
    };

    try {
        const res = await fetch(API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${txt ? ': ' + txt.substring(0,120) : ''}`);
        }
        fecharModalAdd();
        showToast(`"${titulo}" adicionado!`, 'success');
        await carregarLeituras();
        if (document.getElementById('page-explore').classList.contains('active'))
            renderizarExplorar();
    } catch (err) {
        document.getElementById('add-save-text').style.display   = '';
        document.getElementById('add-save-loader').style.display = 'none';
        errEl.textContent = `⚠️ Erro: ${err.message}`;
        errEl.style.display = 'block';
        console.error('[Acervo] Erro ao adicionar:', err);
    }
});

// ══════════════════════════════════════════════════════════════════
//  PERFIL
// ══════════════════════════════════════════════════════════════════
function atualizarAvatar() {
    const nome = localStorage.getItem(NOME_KEY) || '';
    const iniciais = nome
        ? nome.split(' ').filter(Boolean).map(p => p[0]).slice(0,2).join('').toUpperCase()
        : '?';
    [['avatar-initials', iniciais], ['profile-avatar-big', iniciais],
     ['profile-name-display', nome || 'Leitor']].forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    });
    atualizarSaudacao();
}

function renderizarPerfil() {
    atualizarAvatar();

    const concluidos  = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'concluido');
    const emLeitura   = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo').length;
    const pausados    = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'pausado').length;
    const paginasConcl= concluidos.reduce((a,i) => a + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0), 0);
    const paginasAtu  = todasLeituras
        .filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo')
        .reduce((a,i) => a + (parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0), 0);
    const totalPagsLidas = paginasConcl + paginasAtu;
    const mediaPages  = concluidos.length > 0 ? Math.round(paginasConcl / concluidos.length) : 0;
    const categorias  = new Set(todasLeituras.map(i => campo(i,'CATEGORIA','categoria')).filter(Boolean)).size;

    document.getElementById('profile-stats').innerHTML = [
        { label:'Livros no acervo',       val: todasLeituras.length                     },
        { label:'Livros concluídos',       val: concluidos.length                        },
        { label:'Em andamento',            val: emLeitura                                },
        { label:'Pausados',                val: pausados                                 },
        { label:'Total de páginas lidas',  val: totalPagsLidas.toLocaleString('pt-BR')  },
        { label:'Média de págs / livro',   val: mediaPages.toLocaleString('pt-BR')      },
        { label:'Categorias diferentes',   val: categorias                               },
    ].map(r => `
        <div class="ps-row">
            <span class="ps-label">${r.label}</span>
            <span class="ps-val">${r.val}</span>
        </div>`).join('');

    const BADGES = [
        { icon:'📖', name:'Primeira leitura',  desc:'1 livro no acervo',       earned: todasLeituras.length >= 1   },
        { icon:'✅', name:'Leitor dedicado',   desc:'Concluiu 1 livro',        earned: concluidos.length >= 1      },
        { icon:'🔥', name:'Em chamas',         desc:'5 livros concluídos',     earned: concluidos.length >= 5      },
        { icon:'💯', name:'Centenário',        desc:'10 livros concluídos',    earned: concluidos.length >= 10     },
        { icon:'📚', name:'Biblioteca viva',   desc:'20 livros no acervo',     earned: todasLeituras.length >= 20  },
        { icon:'🗺️', name:'Explorador',        desc:'3 categorias diferentes', earned: categorias >= 3             },
        { icon:'📄', name:'Milhar de páginas', desc:'1.000 páginas lidas',     earned: totalPagsLidas >= 1000      },
        { icon:'🏆', name:'Maratonista',       desc:'10.000 páginas lidas',    earned: totalPagsLidas >= 10000     },
        { icon:'🌟', name:'Lendário',          desc:'50 livros concluídos',    earned: concluidos.length >= 50     },
    ];

    document.getElementById('badges-grid').innerHTML = BADGES.map(b => `
        <div class="badge-card ${b.earned ? 'earned' : 'locked'}" title="${b.desc}">
            <span class="badge-icon">${b.icon}</span>
            <span class="badge-name">${b.name}</span>
            <span class="badge-desc">${b.desc}</span>
        </div>`).join('');
}

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

document.getElementById('open-profile-btn').addEventListener('click', () => navegarPara('profile'));

// ══════════════════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════════
function navegarPara(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item[data-page]').forEach(n =>
        n.classList.toggle('active', n.dataset.page === page)
    );

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (page === 'report')  renderizarRelatorio();
    if (page === 'profile') renderizarPerfil();
    if (page === 'explore') renderizarExplorar();
}

document.querySelectorAll('.nav-item').forEach(item => {
    const handler = function () {
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
