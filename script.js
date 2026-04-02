// Substitua pela URL que o APEX gerou para você
const API_URL = 'https://oracleapex.com/ords/progressao/v1/leituras/';

async function carregarLeituras() {
    const container = document.getElementById('reading-list');
    console.log("Iniciando fetch para:", API_URL);

    try {
        const response = await fetch(API_URL);
        
        console.log("Status da resposta:", response.status); // Deve ser 200

        if (!response.ok) {
            throw new Error(`Erro HTTP! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("JSON recebido:", data);

        // O APEX SEMPRE coloca os dados dentro de 'items'
        const leituras = data.items || [];
        console.log("Quantidade de itens encontrados:", leituras.length);

        if (leituras.length === 0) {
            container.innerHTML = "<p style='color: white; text-align: center; margin-top: 50px;'>A tabela está vazia ou o campo 'items' não foi encontrado.</p>";
            return;
        }
container.innerHTML = leituras.map(item => {
    // Mapeamento direto das colunas do seu SELECT *
    const livro = item.LIVRO || "Título indisponível";
    const categoria = item.CATEGORIA || "Geral";
    const status = item.STATUS || "Sem status";
    const capa = item.CAPA_URL || "https://via.placeholder.com/80x110";
    
    // Cálculos de progresso
    const atual = parseInt(item.PAGINA_ATUAL) || 0;
    const total = parseInt(item.TOTAL_PAGINAS) || 1;
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

    } catch (error) {
        console.error("Erro detalhado:", error);
        container.innerHTML = `<p style='color: #ff4d4d; text-align: center; margin-top: 50px;'>Erro ao carregar biblioteca: ${error.message}</p>`;
    }
}

carregarLeituras();