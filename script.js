const API_URL = 'https://oracleapex.com/ords/progressao/v1/leituras/';

// CORRIGIDO: variável global para os dados da API
let todasLeituras = [];
let filtroAtivo = 'todos';
let graficoMensal = null;

async function carregarLeituras() {
    const container = document.getElementById('reading-list');
    console.log("Iniciando busca de dados...");

    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        // O APEX coloca a lista dentro da propriedade 'items'
        const leituras = data.items || [];
        console.log("Itens recebidos do APEX:", leituras);

        if (leituras.length === 0) {
            container.innerHTML = "<p style='color: white; text-align: center; margin-top: 50px;'>Nenhuma leitura encontrada no banco.</p>";
            return;
        }

        // CORRIGIDO: salva no escopo global
        todasLeituras = leituras;
        renderizarCards(todasLeituras);

        console.log("Interface atualizada com sucesso!");

    } catch (error) {
        console.error("Erro crítico:", error);
        container.innerHTML = `<p style='color: #ff4d4d; text-align: center;'>Erro de conexão: ${error.message}</p>`;
    }
}

function renderizarCards(lista) {
    const container = document.getElementById('reading-list');

    if (lista.length === 0) {
        container.innerHTML = "<p style='color: var(--text-sub); text-align: center; margin-top: 50px;'>Nenhum livro nesta categoria.</p>";
        return;
    }

    container.innerHTML = lista.map(item => {
        const livro    = item.LIVRO        || item.livro        || "Sem título";
        const categoria = item.CATEGORIA   || item.categoria    || "Geral";
        const status   = item.STATUS       || item.status       || "Lendo";
        const capa     = item.CAPA_URL     || item.capa_url     || "https://via.placeholder.com/80x110";
        const autor    = item.AUTOR        || item.autor        || "";

        const atual = parseInt(item.PAGINA_ATUAL    || item.pagina_atual)    || 0;
        const total = parseInt(item.TOTAL_PAGINAS   || item.total_paginas)   || 1;
        const perc  = Math.round((atual / total) * 100);

        const classeStatus = getStatusClass(status);

        return `
            <div class="card">
                <img src="${capa}" class="cover" alt="Capa de ${livro}" onerror="this.src='https://via.placeholder.com/80x110'">
                <div class="info">
                    <h3>${livro}</h3>
                    <p>${autor ? autor + ' · ' : ''}${categoria}</p>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${classeStatus}" style="width: ${perc}%"></div>
                        </div>
                        <div class="status-row">
                            <span class="status-text">${perc}% — ${atual}/${total} pgs</span>
                            <span class="status-label ${classeStatus}" style="font-weight:bold">${status}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getStatusClass(status) {
    const s = status ? status.toUpperCase() : '';
    if (s.includes('CONCLU') || s.includes('FINALIZ')) return 'concluido';
    if (s.includes('PAUSAD') || s.includes('ESPERA')) return 'pausado';
    if (s.includes('INICI') || s.includes('LISTA')  || s.includes('QUERO')) return 'para_iniciar';
    return 'lendo';
}

// ─── Filtros por Status ────────────────────────────────────────────────────────

function aplicarFiltro(filtro) {
    filtroAtivo = filtro;

    let lista = todasLeituras;

    if (filtro !== 'todos') {
        lista = todasLeituras.filter(item => {
            const classe = getStatusClass(item.STATUS || item.status || '');
            return classe === filtro;
        });
    }

    renderizarCards(lista);
}

// Event listeners para os botões de filtro
document.querySelectorAll('.categories button').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.categories button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        aplicarFiltro(this.dataset.filter);
    });
});

// ─── Relatório / Dashboard ─────────────────────────────────────────────────────

function mostrarRelatorio() {
    document.getElementById('reading-list').style.display = 'none';
    document.getElementById('report-page').style.display  = 'block';

    const grid = document.getElementById('stats-grid');

    // Métricas gerais
    const totalItens = todasLeituras.length;

    const concluidos = todasLeituras.filter(i =>
        (i.STATUS || '').toUpperCase().includes('CONCLU')
    ).length;

    const lidas  = todasLeituras.reduce((acc, i) => acc + (parseInt(i.PAGINA_ATUAL)   || 0), 0);
    const totais = todasLeituras.reduce((acc, i) => acc + (parseInt(i.TOTAL_PAGINAS)  || 0), 0);
    const progressoGeral = totais > 0 ? Math.round((lidas / totais) * 100) : 0;

    const emAndamento = todasLeituras.filter(i =>
        getStatusClass(i.STATUS || i.status || '') === 'lendo'
    ).length;

    // Cards de métricas
    grid.innerHTML = `
        <div class="stat-card">
            <h4>Acervo Total</h4>
            <p>${totalItens}</p>
        </div>
        <div class="stat-card">
            <h4>Concluídos</h4>
            <p style="color: var(--success)">${concluidos}</p>
        </div>
        <div class="stat-card">
            <h4>Em Leitura</h4>
            <p style="color: var(--primary)">${emAndamento}</p>
        </div>
        <div class="stat-card">
            <h4>Páginas Lidas</h4>
            <p>${lidas.toLocaleString('pt-BR')}</p>
        </div>
        <div class="stat-card stat-full">
            <h4>Saúde da Biblioteca — ${progressoGeral}%</h4>
            <div class="progress-bar" style="margin-top: 15px;">
                <div class="progress-fill lendo" style="width: ${progressoGeral}%"></div>
            </div>
        </div>
    `;

    // Gráfico mensal
    renderizarGraficoMensal();
}

function renderizarGraficoMensal() {
    // Agrupa páginas lidas por mês usando o campo DATA_ATUALIZACAO (ou data_atualizacao)
    // Formato esperado do APEX: "YYYY-MM-DD" ou "DD/MM/YYYY"
    const dadosPorMes = {};

    todasLeituras.forEach(item => {
        const dataRaw = item.DATA_ATUALIZACAO || item.data_atualizacao || null;
        const paginas = parseInt(item.PAGINA_ATUAL || item.pagina_atual) || 0;

        let chave;
        if (dataRaw) {
            // Normaliza formatos DD/MM/YYYY e YYYY-MM-DD
            let d;
            if (dataRaw.includes('/')) {
                const [dia, mes, ano] = dataRaw.split('/');
                d = new Date(`${ano}-${mes}-${dia}`);
            } else {
                d = new Date(dataRaw);
            }
            if (!isNaN(d)) {
                chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }
        }

        // Se não tiver data, agrupa em "Sem data"
        if (!chave) chave = 'Sem data';

        dadosPorMes[chave] = (dadosPorMes[chave] || 0) + paginas;
    });

    // Ordena as chaves cronologicamente (ignora "Sem data" para o final)
    const chaves = Object.keys(dadosPorMes).sort((a, b) => {
        if (a === 'Sem data') return 1;
        if (b === 'Sem data') return -1;
        return a.localeCompare(b);
    });

    const labels  = chaves.map(c => {
        if (c === 'Sem data') return 'Sem data';
        const [ano, mes] = c.split('-');
        return new Date(ano, mes - 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    });
    const valores = chaves.map(c => dadosPorMes[c]);

    const ctx = document.getElementById('monthlyChart').getContext('2d');

    // Destrói gráfico anterior para evitar sobreposição
    if (graficoMensal) graficoMensal.destroy();

    graficoMensal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Páginas lidas',
                data: valores,
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
                borderColor: '#3b82f6',
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
                        label: ctx => ` ${ctx.parsed.y.toLocaleString('pt-BR')} páginas`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#2d3748' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { color: '#2d3748' },
                    ticks: {
                        color: '#94a3b8',
                        callback: v => v.toLocaleString('pt-BR')
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

function mostrarInicio() {
    document.getElementById('report-page').style.display  = 'none';
    document.getElementById('reading-list').style.display = 'block';
    // CORRIGIDO: re-renderiza sem recarregar a página
    aplicarFiltro(filtroAtivo);
}

// ─── Nav inferior ──────────────────────────────────────────────────────────────

// CORRIGIDO: identificação por data-page, sem depender de innerText
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function () {
        const page = this.dataset.page;
        if (!page || page === 'add' || page === 'explore' || page === 'profile') return;

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        this.classList.add('active');

        if (page === 'report') mostrarRelatorio();
        if (page === 'home')   mostrarInicio();
    });
});

// ─── Inicialização ─────────────────────────────────────────────────────────────
carregarLeituras();
