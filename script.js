// ══════════════════════════════════════════════════════════════════
//  ACERVO LITERÁRIO — script.js
//
//  Estrutura real da tabela PROGRESSAO_LEITURA:
//  ID, LIVRO, CATEGORIA, TOTAL_PAGINAS, PAGINA_ATUAL,
//  MES_INICIO, MES_FIM, STATUS, CAPA_URL
//
//  Valores reais de STATUS no banco:
//  'Concluído' | 'Em andamento' | 'Para Iniciar' | 'Pausado'
//
//  APEX ORDS pagina em 25 por padrão → fetchTodosRegistros() itera páginas
//  Resposta ORDS: { items: [], hasMore: bool, limit: N, offset: N, links: [...] }
// ══════════════════════════════════════════════════════════════════

// ── Config ────────────────────────────────────────────────────────
const API_URL   = 'https://oracleapex.com/ords/progressao/v1/leituras/leituras/';
const METAS_URL = 'https://oracleapex.com/ords/progressao/v1/metas/';

const APEX_LIMIT = 500;

const NOME_KEY  = 'acervo_nome';
const DATA_KEY  = 'acervo_dados_cache';

// ── Estado global ─────────────────────────────────────────────────
let todasLeituras = [];
let filtroAtivo   = 'lendo';
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

/** Rótulo legível para exibição no card */
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

/**
 * Lê um campo do objeto com suporte a MAIÚSCULAS e minúsculas.
 * APEX ORDS retorna campos em minúsculas por padrão, mas pode variar.
 */
function campo(item, ...nomes) {
    for (const n of nomes) {
        if (item[n]               !== undefined && item[n]               !== null && item[n]               !== '') return item[n];
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
    const base = h < 5  ? 'Boa madrugada 🌙'
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
 * APEX ORDS retorna apenas 25 registros por padrão.
 * Esta função busca TODOS os registros iterando as páginas.
 */
async function fetchTodosRegistros(baseUrl) {
    let todos     = [];
    let nextUrl   = `${baseUrl}?limit=${APEX_LIMIT}&offset=0`;
    let tentativa = 0;
    const MAX_TENTATIVAS = 20;

    while (nextUrl && tentativa < MAX_TENTATIVAS) {
        tentativa++;
        const res = await fetch(nextUrl, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data  = await res.json();
        const itens = Array.isArray(data) ? data : (data.items || []);
        todos = todos.concat(itens);

        console.log(`[Acervo] Página ${tentativa}: ${itens.length} itens (total: ${todos.length})`);

        if (data.hasMore === true || data.hasMore === 'true') {
            const linkNext = (data.links || []).find(l => l.rel === 'next');
            nextUrl = linkNext?.href
                   || `${baseUrl}?limit=${APEX_LIMIT}&offset=${(data.offset || 0) + (data.limit || APEX_LIMIT)}`;
        } else {
            nextUrl = null;
        }
    }

    return todos;
}

// ══════════════════════════════════════════════════════════════════
//  CARREGAR LEITURAS
// ══════════════════════════════════════════════════════════════════
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

        // Cache local para uso offline
        try { localStorage.setItem(DATA_KEY, JSON.stringify(todasLeituras)); } catch(_) {}

        if (!todasLeituras.length) {
            container.innerHTML = `<p class='empty-msg'>
                <span class='em-icon'>📚</span>
                Nenhuma leitura encontrada.
            </p>`;
            return;
        }

        // Log de diagnóstico
        const porStatus = {};
        todasLeituras.forEach(i => {
            const s = campo(i,'STATUS','status') || '(vazio)';
            porStatus[s] = (porStatus[s] || 0) + 1;
        });
        console.log(`[Acervo] Total carregado: ${todasLeituras.length} livros`);
        console.table(porStatus);

        aplicarFiltro('lendo');
        atualizarAvatar();
        atualizarSaudacao();

    } catch (err) {
        console.error('[Acervo] Erro:', err);

        // Tenta usar cache local
        try {
            const cache = localStorage.getItem(DATA_KEY);
            if (cache) {
                todasLeituras = JSON.parse(cache);
                if (todasLeituras.length) {
                    aplicarFiltro('lendo');
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

        const capa  = capaRaw || 'https://placehold.co/68x96/f0ede8/b0a89e?text=📖';
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
                 onerror="this.src='https://placehold.co/68x96/f0ede8/b0a89e?text=📖'">
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

    // Sincroniza botão ativo na nav de categorias
    document.querySelectorAll('.categories button').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === filtro)
    );

    renderizarCards(lista);
}

document.querySelectorAll('.categories button').forEach(btn => {
    btn.addEventListener('click', function () {
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
        const livro     = campo(item,'LIVRO','livro')           || 'Sem título';
        const cat       = campo(item,'CATEGORIA','categoria')   || 'Geral';
        const statusRaw = campo(item,'STATUS','status')         || '';
        const capaRaw   = campo(item,'CAPA_URL','capa_url')     || '';
        const capa      = capaRaw || 'https://placehold.co/68x96/f0ede8/b0a89e?text=📖';
        const atual     = parseInt(campo(item,'PAGINA_ATUAL','pagina_atual'))   || 0;
        const total     = parseInt(campo(item,'TOTAL_PAGINAS','total_paginas')) || 0;
        const perc      = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
        const cls       = getStatusClass(statusRaw);
        const label     = statusLabel(cls, statusRaw);

        return `
        <div class="card" style="animation-delay:${Math.min(i*0.03,0.4)}s">
            <img src="${capa}" class="cover" alt="${livro.replace(/"/g,'&quot;')}" loading="lazy"
                 onerror="this.src='https://placehold.co/68x96/f0ede8/b0a89e?text=📖'">
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
//  PERFIL
// ══════════════════════════════════════════════════════════════════
function atualizarAvatar() {
    const nome    = localStorage.getItem(NOME_KEY) || '';
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

    const concluidos   = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'concluido');
    const emLeitura    = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo').length;
    const pausados     = todasLeituras.filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'pausado').length;
    const paginasConcl = concluidos.reduce((a,i) => a + (parseInt(campo(i,'TOTAL_PAGINAS','total_paginas')) || 0), 0);
    const paginasAtu   = todasLeituras
        .filter(i => getStatusClass(campo(i,'STATUS','status')||'') === 'lendo')
        .reduce((a,i) => a + (parseInt(campo(i,'PAGINA_ATUAL','pagina_atual')) || 0), 0);
    const totalPagsLidas = paginasConcl + paginasAtu;
    const mediaPages   = concluidos.length > 0 ? Math.round(paginasConcl / concluidos.length) : 0;
    const categorias   = new Set(todasLeituras.map(i => campo(i,'CATEGORIA','categoria')).filter(Boolean)).size;

    document.getElementById('profile-stats').innerHTML = [
        { label:'Livros no acervo',       val: todasLeituras.length                    },
        { label:'Livros concluídos',       val: concluidos.length                       },
        { label:'Em andamento',            val: emLeitura                               },
        { label:'Pausados',                val: pausados                                },
        { label:'Total de páginas lidas',  val: totalPagsLidas.toLocaleString('pt-BR') },
        { label:'Média de págs / livro',   val: mediaPages.toLocaleString('pt-BR')     },
        { label:'Categorias diferentes',   val: categorias                              },
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
    const wrap    = document.getElementById('profile-edit-wrap');
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

    if (page === 'profile') renderizarPerfil();
    if (page === 'explore') renderizarExplorar();
}

document.querySelectorAll('.nav-item').forEach(item => {
    const handler = function () {
        const page = this.dataset.page;
        if (!page) return;
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
