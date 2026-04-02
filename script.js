// Substitua pela URL que o APEX gerou para você
const API_URL = 'https://oracleapex.com/ords/progressao/v1/leituras/';

async function carregarLeituras() {
    const container = document.getElementById('reading-list');

    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        // O ORDS devolve os dados dentro da propriedade 'items'
        const leituras = data.items;

        container.innerHTML = leituras.map(item => `
            <div class="card">
                <img src="${item.capa_url || 'https://via.placeholder.com/80x110'}" class="cover" alt="Capa">
                <div class="info">
                    <h3>${item.livro}</h3>
                    <p>${item.categoria} • ${item.status}</p>
                    
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${item.percentual}%"></div>
                        </div>
                        <div class="status-row">
                            <span class="status-text">${item.percentual}% - ${item.pagina_atual}/${item.total_paginas} pgs</span>
                            <span class="status-label">${item.status}</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error("Erro ao carregar dados do APEX:", error);
        container.innerHTML = "<p style='color: white; padding: 20px;'>Erro ao carregar biblioteca.</p>";
    }
}

// Inicia a carga ao abrir a página
carregarLeituras();