const API_URL = 'SUA_URL_DO_APEX_AQUI';

async function carregarLeituras() {
    const container = document.getElementById('reading-list');

    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        // O ORDS do APEX sempre envia os dados dentro de 'items'
        const leituras = data.items || [];

        if (leituras.length === 0) {
            container.innerHTML = "<p style='color: white; text-align: center; margin-top: 50px;'>Nenhuma leitura encontrada.</p>";
            return;
        }

        container.innerHTML = leituras.map(item => {
            // FORÇANDO O MAPEAMENTO (Independente de maiúsculo/minúsculo)
            const livro = item.LIVRO || item.livro || "Sem título";
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
                        <h3>${livro}</h3>
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
        console.error("Erro:", error);
        container.innerHTML = "<p style='color: #ff4d4d; text-align: center;'>Erro ao carregar dados.</p>";
    }
}

carregarLeituras();