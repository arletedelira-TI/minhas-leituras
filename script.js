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

        container.innerHTML = leituras.map(item => {
            // MAPEAMENTO COMPATÍVEL (Aceita LIVRO ou livro)
            const titulo = item.LIVRO || item.livro || "Sem título";
            const categoria = item.CATEGORIA || item.categoria || "Geral";
            const status = item.STATUS || item.status || "Lendo";
            const capa = item.CAPA_URL || item.capa_url || "https://via.placeholder.com/80x110";
            
            const atual = parseInt(item.PAGINA_ATUAL || item.pagina_atual) || 0;
            const total = parseInt(item.TOTAL_PAGINAS || item.total_paginas) || 1;
            const perc = Math.round((atual / total) * 100);

            return `
                <div class="card">
                    <img src="${capa}" class="cover" alt="Capa" onerror="this.src='https://via.placeholder.com/80x110'">
                    <div class="info">
                        <h3>${titulo}</h3>
                        <p>${categoria} • ${status}</p>
                        
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${perc}%"></div>
                            </div>
                            <div class="status-row">
                                <span class="status-text">${perc}% - ${atual}/${total} pgs</span>
                                <span class="status-label">${status}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        console.log("Interface atualizada com sucesso!");

    } catch (error) {
        console.error("Erro crítico:", error);
        container.innerHTML = `<p style='color: #ff4d4d; text-align: center;'>Erro de conexão: ${error.message}</p>`;
    }
}

// Executa a função
carregarLeituras();