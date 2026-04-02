const API_URL = 'https://oracleapex.com/ords/progressao/v1/leituras/';

let todasLeituras = [];

async function carregarLeituras() {
    const container = document.getElementById('reading-list');
    
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        todasLeituras = data.items || [];
        
        renderizarCards(todasLeituras);
        configurarFiltros();
        
    } catch (error) {
        console.error("Erro:", error);
        container.innerHTML = "<p style='text-align:center; padding:50px;'>Erro ao conectar com o banco de dados.</p>";
    }
}

function getStatusClass(status) {
    const s = status ? status.toUpperCase() : '';
    if (s.includes('CONCLUÍDO') || s.includes('FINALIZADO')) return 'concluido';
    if (s.includes('PAUSADO') || s.includes('ESPERA')) return 'pausado';
    return 'lendo';
}

function renderizarCards(lista) {
    const container = document.getElementById('reading-list');
    
    if (lista.length === 0) {
        container.innerHTML = "<p style='text-align:center; padding:50px; color:gray;'>Nenhum item nesta categoria.</p>";
        return;
    }

    container.innerHTML = lista.map(item => {
        const livro = item.LIVRO || "Sem título";
        const categoria = item.CATEGORIA || "Geral";
        const status = item.STATUS || "Lendo";
        const atual = parseInt(item.PAGINA_ATUAL) || 0;
        const total = parseInt(item.TOTAL_PAGINAS) || 1;
        const perc = Math.round((atual / total) * 100);
        const classeStatus = getStatusClass(status);

        return `
            <div class="card">
                <img src="${item.CAPA_URL || 'https://via.placeholder.com/80x110'}" class="cover">
                <div class="info">
                    <h3>${livro}</h3>
                    <p>${categoria}</p>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill ${classeStatus}" style="width: ${perc}%"></div>
                        </div>
                        <div class="status-row">
                            <span>${perc}% - ${atual}/${total} pgs</span>
                            <span class="${classeStatus}" style="font-weight:bold">${status}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function configurarFiltros() {
    const botoes = document.querySelectorAll('.categories button');
    
    botoes.forEach(btn => {
        btn.onclick = () => {
            botoes.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const categoriaAlvo = btn.innerText.toLowerCase();
            
            if (categoriaAlvo === 'tudo') {
                renderizarCards(todasLeituras);
            } else {
                // Filtra se a categoria do banco contém o texto do botão
                const filtrados = todasLeituras.filter(item => 
                    item.CATEGORIA.toLowerCase().includes(categoriaAlvo.substring(0, 4))
                );
                renderizarCards(filtrados);
            }
        };
    });
}

// Inicialização
carregarLeituras();