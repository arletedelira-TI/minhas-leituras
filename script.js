const API_URL = 'https://oracleapex.com/ords/progressao/v1/leituras/'; 

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

        // Chamamos a função de renderização passando a lista do banco
        renderizarCards(leituras);

        console.log("Interface atualizada com sucesso!");

    } catch (error) {
        console.error("Erro crítico:", error);
        container.innerHTML = `<p style='color: #ff4d4d; text-align: center;'>Erro de conexão: ${error.message}</p>`;
    }
}

function renderizarCards(lista) {
    const container = document.getElementById('reading-list');
    
    container.innerHTML = lista.map(item => {
        // MAPEAMENTO COMPATÍVEL (Prioriza MAIÚSCULAS do APEX)
        const livro = item.LIVRO || item.livro || "Sem título";
        const categoria = item.CATEGORIA || item.categoria || "Geral";
        const status = item.STATUS || item.status || "Lendo";
        const capa = item.CAPA_URL || item.capa_url || "https://via.placeholder.com/80x110";
        
        const atual = parseInt(item.PAGINA_ATUAL || item.pagina_atual) || 0;
        const total = parseInt(item.TOTAL_PAGINAS || item.total_paginas) || 1;
        const perc = Math.round((atual / total) * 100);
        
        // Define a classe de cor baseada no status
        const classeStatus = getStatusClass(status); 

        return `
            <div class="card">
                <img src="${capa}" class="cover" alt="Capa" onerror="this.src='https://via.placeholder.com/80x110'">
                <div class="info">
                    <h3>${livro}</h3>
                    <p>${categoria}</p>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${classeStatus}" style="width: ${perc}%"></div>
                        </div>
                        <div class="status-row">
                            <span class="status-text">${perc}% - ${atual}/${total} pgs</span>
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
    if (s.includes('CONCLUÍDO') || s.includes('FINALIZADO')) return 'concluido';
    if (s.includes('PAUSADO') || s.includes('ESPERA')) return 'pausado';
    return 'lendo';
}

// Inicia a execução
carregarLeituras();

function mostrarRelatorio() {
    // 1. Alterna as telas
    document.getElementById('reading-list').style.display = 'none';
    document.getElementById('report-page').style.display = 'block';
    
    const grid = document.getElementById('stats-grid');
    
    // 2. Cálculos Inteligentes
    const totalItens = todasLeituras.length;
    
    // Conta concluídos (independente de maiúsculas/minúsculas)
    const concluidos = todasLeituras.filter(i => 
        (i.STATUS || "").toUpperCase().includes("CONCLU")
    ).length;

    // Soma total de páginas (usando os nomes das colunas do APEX)
    const lidas = todasLeituras.reduce((acc, i) => acc + (parseInt(i.PAGINA_ATUAL) || 0), 0);
    const totais = todasLeituras.reduce((acc, i) => acc + (parseInt(i.TOTAL_PAGINAS) || 0), 0);
    const progressoGeral = totais > 0 ? Math.round((lidas / totais) * 100) : 0;

    // 3. Renderiza os cards de métricas
    grid.innerHTML = `
        <div class="stat-card">
            <h4>Acervo Técnico</h4>
            <p>${totalItens}</p>
        </div>
        <div class="stat-card">
            <h4>Concluídos</h4>
            <p>${concluidos}</p>
        </div>
        <div class="stat-card stat-full">
            <h4>Total de Páginas Lidas</h4>
            <p>${lidas.toLocaleString()}</p>
        </div>
        <div class="stat-card stat-full">
            <h4>Saúde da Biblioteca</h4>
            <p>${progressoGeral}%</p>
            <div class="progress-bar" style="margin-top: 15px;">
                <div class="progress-fill lendo" style="width: ${progressoGeral}%"></div>
            </div>
        </div>
    `;
}

// Vincula o botão "Relatórios" da barra inferior
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
        if (this.innerText.includes('Relatórios')) {
            mostrarRelatorio();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            this.classList.add('active');
        } else if (this.innerText.includes('Início')) {
            location.reload(); // Recarrega para voltar à lista original
        }
    });
});