// ── Config ────────────────────────────────────────────────────────────────────
const API_URL   = 'https://oracleapex.com/ords/progressao/v1/leituras/';
const METAS_URL = 'https://oracleapex.com/ords/progressao/v1/metas/';

// ── Estado global ─────────────────────────────────────────────────────────────
let todasLeituras  = [];
let filtroAtivo    = 'todos';
let anoRelatorio   = new Date().getFullYear();
let graficoMensal  = null;
let chipCategoria  = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function getStatusClass(status) {
    const s = (status || '').toUpperCase();
    if (s.includes('CONCLU') || s.includes('FINALIZ')) return 'concluido';
    if (s.includes('PAUSAD') || s.includes('ESPERA'))  return 'pausado';
    if (s.includes('INICI')  || s.includes('LISTA')  || s.includes('QUERO')) return 'para_iniciar';
    return 'lendo';
}

function getMes(item) {
    // Usa MES_FIM (concluído) ou MES_INICIO como fallback
    const raw = item.MES_FIM || item.mes_fim || item.MES_INICIO || item.mes_inicio || null;
    if (!raw) return null;
    // Aceita "YYYY-MM", "YYYY-MM-DD", "MM/YYYY", "DD/MM/YYYY"
    if (/^\d{4}-\d{2}/.test(raw)) return raw.substring(0, 7);          // "YYYY-MM-DD" → "YYYY-MM"
    if (/^\d{2}\/\d{4}$/.test(raw)) {
        const [m, y] = raw.split('/');
        return `${y}-${m}`;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
        const [, m, y] = raw.split('/');
        return `${y}-${m}`;
    }
    return null;
}

function nomeMes(chave) {
    const [y, m] = chave.split('-');
    return new Date(+y, +m - 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

// ── Fetch dados ────────────────────────────────────────────────────────────────
async function carregarLeituras() {
    const container = document.getElementById('reading-list');
    try {
        const res  = await fetch(API_URL);
        const data = await res.json();
        todasLeituras = data.items || [];

        if (!todasLeituras.length) {
            container.innerHTML = "<p class='empty-msg'>Nenhuma leitura encontrada no banco.</p>";
            return;
        }

        renderizarCards(todasLeituras);
        atualizarAvatar();
        renderizarExplorar();

    } catch (err) {
        console.error('Erro crítico:', err);
        container.innerHTML = `<p class='empty-msg' style='color:var(--danger)'>Erro de conexão: ${err.message}</p>`;
    }
}

// ── Renderizar cards ───────────────────────────────────────────────────────────
function renderizarCards(lista) {
    const container = document.getElementById('reading-list');

    if (!lista.length) {
        container.innerHTML = "<p class='empty-msg'>Nenhum livro nesta categoria.</p>";
        return;
    }

    container.innerHTML = lista.map((item, i) => {
        const livro    = item.LIVRO       || item.livro       || 'Sem título';
        const cat      = item.CATEGORIA   || item.categoria   || 'Geral';
        const status   = item.STATUS      || item.status      || 'Lendo';
        const capa     = item.CAPA_URL    || item.capa_url    || 'https://placehold.co/72x100/1e2332/7a8299?text=📖';
        const atual    = parseInt(item.PAGINA_ATUAL  || item.pagina_atual)  || 0;
        const total    = parseInt(item.TOTAL_PAGINAS || item.total_paginas) || 1;
        const perc     = Math.round((atual / total) * 100);
        const cls      = getStatusClass(status);
        const mesInicio = item.MES_INICIO || item.mes_inicio || '';

        return `
        <div class="card" style="animation-delay:${i * 0.05}s">
            <img src="${capa}" class="cover" alt="${livro}"
                 onerror="this.src='https://placehold.co/72x100/1e2332/7a8299?text=📖'">
            <div class="info">
                <h3 title="${livro}">${livro}</h3>
                <p>${cat}${mesInicio ? ' · ' + mesInicio : ''}</p>
                <div class="progress-bar">
                    <div class="progress-fill ${cls}" style="width:${perc}%"></div>
                </div>
                <div class="status-row">
                    <span>${perc}% — ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} pgs</span>
                    <span class="status-label ${cls}" style="font-weight:600">${status}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ── Filtros ────────────────────────────────────────────────────────────────────
function aplicarFiltro(filtro) {
    filtroAtivo = filtro;
    const lista = filtro === 'todos'
        ? todasLeituras
        : todasLeituras.filter(i => getStatusClass(i.STATUS || i.status || '') === filtro);
    renderizarCards(lista);
}

document.querySelectorAll('.categories button').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.categories button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        aplicarFiltro(this.dataset.filter);
    });
});

// ── Explorar ───────────────────────────────────────────────────────────────────
function renderizarExplorar() {
    // Grid de status
    const statusInfo = [
        { key: 'lendo',        label: 'Em leitura' },
        { key: 'concluido',    label: 'Concluídos' },
        { key: 'pausado',      label: 'Pausados' },
        { key: 'para_iniciar', label: 'Para iniciar' },
    ];
    const grid = document.getElementById('status-grid');
    grid.innerHTML = statusInfo.map(s => {
        const count = todasLeituras.filter(i => getStatusClass(i.STATUS || i.status || '') === s.key).length;
        return `
        <div class="explore-status-card ${s.key}" data-filter="${s.key}">
            <span class="esc-count">${count}</span>
            <span class="esc-label">${s.label}</span>
        </div>`;
    }).join('');

    grid.querySelectorAll('.explore-status-card').forEach(card => {
        card.addEventListener('click', () => {
            navegarPara('home');
            aplicarFiltro(card.dataset.filter);
            document.querySelectorAll('.categories button').forEach(b => {
                b.classList.toggle('active', b.dataset.filter === card.dataset.filter);
            });
        });
    });

    // Chips de categoria
    const cats = [...new Set(todasLeituras.map(i => i.CATEGORIA || i.categoria || 'Geral').filter(Boolean))];
    const chipsEl = document.getElementById('category-chips');
    chipsEl.innerHTML = cats.map(c => `<span class="chip" data-cat="${c}">${c}</span>`).join('');

    chipsEl.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', function () {
            const ativo = this.classList.contains('active-chip');
            chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active-chip'));
            chipCategoria = ativo ? null : this.dataset.cat;
            if (!ativo) this.classList.add('active-chip');
            filtrarExplorar(document.getElementById('search-input').value);
        });
    });

    filtrarExplorar('');
}

function filtrarExplorar(query) {
    const q = query.toLowerCase();
    let lista = todasLeituras;

    if (chipCategoria) lista = lista.filter(i => (i.CATEGORIA || i.categoria) === chipCategoria);
    if (q)             lista = lista.filter(i =>
        (i.LIVRO || i.livro || '').toLowerCase().includes(q) ||
        (i.CATEGORIA || i.categoria || '').toLowerCase().includes(q)
    );

    const el = document.getElementById('explore-results');
    if (!lista.length) {
        el.innerHTML = "<p class='empty-msg'>Nenhum resultado.</p>";
        return;
    }
    el.innerHTML = lista.map((item, i) => {
        const livro  = item.LIVRO || item.livro || 'Sem título';
        const cat    = item.CATEGORIA || item.categoria || 'Geral';
        const status = item.STATUS    || item.status    || 'Lendo';
        const capa   = item.CAPA_URL  || item.capa_url  || 'https://placehold.co/72x100/1e2332/7a8299?text=📖';
        const atual  = parseInt(item.PAGINA_ATUAL  || item.pagina_atual)  || 0;
        const total  = parseInt(item.TOTAL_PAGINAS || item.total_paginas) || 1;
        const perc   = Math.round((atual / total) * 100);
        const cls    = getStatusClass(status);
        return `
        <div class="card" style="animation-delay:${i * 0.04}s">
            <img src="${capa}" class="cover" alt="${livro}"
                 onerror="this.src='https://placehold.co/72x100/1e2332/7a8299?text=📖'">
            <div class="info">
                <h3 title="${livro}">${livro}</h3>
                <p>${cat}</p>
                <div class="progress-bar">
                    <div class="progress-fill ${cls}" style="width:${perc}%"></div>
                </div>
                <div class="status-row">
                    <span>${perc}% — ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} pgs</span>
                    <span class="status-label ${cls}" style="font-weight:600">${status}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

document.getElementById('search-input').addEventListener('input', e => filtrarExplorar(e.target.value));

// ── Relatório ──────────────────────────────────────────────────────────────────
async function renderizarRelatorio() {
    const ano = anoRelatorio;
    document.getElementById('year-label').textContent = ano;

    const doAno = todasLeituras.filter(i => {
        const mes = getMes(i);
        return mes && mes.startsWith(String(ano));
    });

    // Métricas
    const concluidos = todasLeituras.filter(i => getStatusClass(i.STATUS || i.status || '') === 'concluido');
    const concluidosAno = doAno.filter(i => getStatusClass(i.STATUS || i.status || '') === 'concluido');
    const totalPags = todasLeituras.reduce((a, i) => a + (parseInt(i.PAGINA_ATUAL || i.pagina_atual) || 0), 0);
    const paginasAno = doAno.reduce((a, i) => a + (parseInt(i.TOTAL_PAGINAS || i.total_paginas) || 0), 0);
    const emLeitura  = todasLeituras.filter(i => getStatusClass(i.STATUS || i.status || '') === 'lendo').length;

    document.getElementById('stats-grid').innerHTML = `
        <div class="stat-card"><h4>Concluídos ${ano}</h4><p style="color:var(--success)">${concluidosAno.length}</p></div>
        <div class="stat-card"><h4>Em leitura</h4><p style="color:var(--primary)">${emLeitura}</p></div>
        <div class="stat-card"><h4>Páginas em ${ano}</h4><p>${paginasAno.toLocaleString('pt-BR')}</p></div>
        <div class="stat-card"><h4>Total de páginas</h4><p>${totalPags.toLocaleString('pt-BR')}</p></div>
        <div class="stat-card stat-full"><h4>Acervo total</h4><p>${todasLeituras.length}</p></div>
    `;

    // Meta anual
    await carregarMeta(ano, concluidos.length);

    // Gráfico mensal: soma TOTAL_PAGINAS dos concluídos por MES_FIM
    const meses = {};
    for (let m = 1; m <= 12; m++) {
        meses[`${ano}-${String(m).padStart(2, '0')}`] = 0;
    }
    todasLeituras.forEach(i => {
        const mes = getMes(i);
        if (mes && mes.startsWith(String(ano)) && meses[mes] !== undefined) {
            meses[mes] += parseInt(i.TOTAL_PAGINAS || i.total_paginas) || 0;
        }
    });

    const labels  = Object.keys(meses).map(nomeMes);
    const valores  = Object.values(meses);

    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (graficoMensal) graficoMensal.destroy();

    graficoMensal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: valores,
                backgroundColor: valores.map(v => v > 0 ? 'rgba(79,142,247,0.75)' : 'rgba(79,142,247,0.12)'),
                borderColor:     valores.map(v => v > 0 ? '#4f8ef7' : 'transparent'),
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: c => ` ${c.parsed.y.toLocaleString('pt-BR')} páginas`
                    }
                }
            },
            scales: {
                x: { grid: { color: '#272d3d' }, ticks: { color: '#7a8299', font: { family: 'DM Sans' } } },
                y: {
                    grid: { color: '#272d3d' },
                    ticks: { color: '#7a8299', font: { family: 'DM Sans' }, callback: v => v.toLocaleString('pt-BR') },
                    beginAtZero: true
                }
            }
        }
    });

    // Top livros concluídos (maiores em páginas)
    const top = [...concluidos]
        .sort((a, b) => (parseInt(b.TOTAL_PAGINAS || 0) - parseInt(a.TOTAL_PAGINAS || 0)))
        .slice(0, 5);
    const maxPags = parseInt(top[0]?.TOTAL_PAGINAS || 1);
    const rankClasses = ['gold', 'silver', 'bronze', '', ''];

    document.getElementById('top-books').innerHTML = top.length
        ? top.map((item, i) => {
            const nome = item.LIVRO || item.livro || 'Sem título';
            const pags = parseInt(item.TOTAL_PAGINAS || item.total_paginas) || 0;
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
        : "<p class='empty-msg' style='margin-top:12px'>Nenhum livro concluído ainda.</p>";
}

// ── Meta anual ─────────────────────────────────────────────────────────────────
async function carregarMeta(ano, concluidosTotal) {
    let valorMeta = 12; // padrão
    try {
        const res  = await fetch(METAS_URL);
        const data = await res.json();
        const metas = data.items || [];
        const metaAno = metas.find(m => +m.ANO === ano && (m.MES === null || m.MES === undefined));
        if (metaAno) valorMeta = +metaAno.VALOR_META;
    } catch (_) { /* usa padrão se a API falhar */ }

    const pct = Math.min(100, Math.round((concluidosTotal / valorMeta) * 100));
    const circumference = 2 * Math.PI * 34; // r=34
    const offset = circumference * (1 - pct / 100);

    document.getElementById('meta-concluidos').textContent = concluidosTotal;
    document.getElementById('meta-total').textContent      = valorMeta;
    document.getElementById('meta-ring-fill').style.strokeDashoffset = offset;
    document.getElementById('meta-ring-pct').textContent  = pct + '%';
    document.getElementById('modal-ano').textContent       = ano;
    document.getElementById('modal-meta-input').value      = valorMeta;
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
    try {
        // Tenta encontrar meta existente para o ano
        const res   = await fetch(METAS_URL);
        const data  = await res.json();
        const metas = data.items || [];
        const exist = metas.find(m => +m.ANO === anoRelatorio && !m.MES);

        if (exist) {
            await fetch(`${METAS_URL}${exist.ID}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ANO: anoRelatorio, TIPO: 'LIVROS', VALOR_META: val })
            });
        } else {
            await fetch(METAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ANO: anoRelatorio, TIPO: 'LIVROS', VALOR_META: val })
            });
        }
    } catch (_) { /* salva localmente se API falhar */ }

    document.getElementById('modal-meta').style.display = 'none';
    renderizarRelatorio();
});

// Seletor de ano
document.getElementById('year-prev').addEventListener('click', () => { anoRelatorio--; renderizarRelatorio(); });
document.getElementById('year-next').addEventListener('click', () => { anoRelatorio++; renderizarRelatorio(); });

// ── Perfil ─────────────────────────────────────────────────────────────────────
const NOME_KEY = 'biblio_nome';

function atualizarAvatar() {
    const nome = localStorage.getItem(NOME_KEY) || '';
    const iniciais = nome
        ? nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
        : '?';
    document.getElementById('avatar-initials').textContent       = iniciais;
    document.getElementById('profile-avatar-big').textContent    = iniciais;
    document.getElementById('profile-name-display').textContent  = nome || 'Leitor';
}

function renderizarPerfil() {
    atualizarAvatar();

    // Stats de resumo
    const concluidos   = todasLeituras.filter(i => getStatusClass(i.STATUS || i.status || '') === 'concluido').length;
    const totalPags    = todasLeituras.reduce((a, i) => a + (parseInt(i.TOTAL_PAGINAS || i.total_paginas) || 0), 0);
    const emLeitura    = todasLeituras.filter(i => getStatusClass(i.STATUS || i.status || '') === 'lendo').length;
    const categorias   = new Set(todasLeituras.map(i => i.CATEGORIA || i.categoria)).size;
    const mediaPages   = concluidos > 0 ? Math.round(totalPags / concluidos) : 0;

    document.getElementById('profile-stats').innerHTML = [
        { label: 'Livros no acervo',         val: todasLeituras.length },
        { label: 'Livros concluídos',         val: concluidos },
        { label: 'Em leitura agora',          val: emLeitura },
        { label: 'Total de páginas lidas',    val: totalPags.toLocaleString('pt-BR') },
        { label: 'Média de pgs / livro',      val: mediaPages.toLocaleString('pt-BR') },
        { label: 'Categorias diferentes',     val: categorias },
    ].map(r => `
        <div class="ps-row">
            <span class="ps-label">${r.label}</span>
            <span class="ps-val">${r.val}</span>
        </div>`).join('');

    // Badges / conquistas
    const BADGES = [
        {
            icon: '📖', name: 'Primeira leitura',
            desc: 'Adicionou o 1º livro',
            earned: todasLeituras.length >= 1
        },
        {
            icon: '✅', name: 'Leitor dedicado',
            desc: 'Concluiu 1 livro',
            earned: concluidos >= 1
        },
        {
            icon: '🔥', name: 'Em chamas',
            desc: 'Concluiu 5 livros',
            earned: concluidos >= 5
        },
        {
            icon: '💯', name: 'Centenário',
            desc: '10 livros concluídos',
            earned: concluidos >= 10
        },
        {
            icon: '📚', name: 'Biblioteca viva',
            desc: '20 livros no acervo',
            earned: todasLeituras.length >= 20
        },
        {
            icon: '🗺️', name: 'Explorador',
            desc: '3 categorias diferentes',
            earned: categorias >= 3
        },
        {
            icon: '📄', name: 'Milhar de páginas',
            desc: '1.000 páginas lidas',
            earned: totalPags >= 1000
        },
        {
            icon: '🏆', name: 'Maratonista',
            desc: '10.000 páginas lidas',
            earned: totalPags >= 10000
        },
        {
            icon: '🌟', name: 'Lendário',
            desc: '50 livros concluídos',
            earned: concluidos >= 50
        },
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
    const show = wrap.style.display === 'none';
    wrap.style.display = show ? 'flex' : 'none';
    if (show) document.getElementById('profile-name-input').value = localStorage.getItem(NOME_KEY) || '';
});

document.getElementById('save-name-btn').addEventListener('click', () => {
    const nome = document.getElementById('profile-name-input').value.trim();
    if (nome) {
        localStorage.setItem(NOME_KEY, nome);
        document.getElementById('profile-edit-wrap').style.display = 'none';
        atualizarAvatar();
    }
});

// Atalho: clicar no avatar da home vai para perfil
document.getElementById('open-profile-btn').addEventListener('click', () => navegarPara('profile'));

// ── Navegação ──────────────────────────────────────────────────────────────────
function navegarPara(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === page);
    });

    window.scrollTo(0, 0);

    if (page === 'report')  renderizarRelatorio();
    if (page === 'profile') renderizarPerfil();
    if (page === 'explore') renderizarExplorar();
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function () {
        const page = this.dataset.page;
        if (!page || page === 'add') return;
        navegarPara(page);
    });
});

// ── Init ───────────────────────────────────────────────────────────────────────
atualizarAvatar();
carregarLeituras();
