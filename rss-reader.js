// rss-reader.js - Busca RSS com deduplicação, resolução de URLs e correção de fonte
const RSS_URL = 'https://news.google.com/rss/search?q=%22empr%C3%A9stimo+consignado%22+OR+%22reajuste+salarial%22+OR+%22Reajuste+salarial+servidores%22+OR+%22margem+consign%C3%A1vel%22&hl=pt-BR&gl=BR&ceid=BR:pt-419';
const RSS2JSON_API_KEY = '7z7tg0enqpufvp94s3qvhsbsznctjpqswlnegfej';
const MAX_TENTATIVAS = 3;

function normalizarTitulo(titulo) {
    return titulo
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s-\s[^-]+$/, "")
        .replace(/[^\w\s]/g, "")
        .trim();
}

function similaridadeTitulos(a, b) {
    const palavrasA = new Set(a.split(/\s+/).filter(p => p.length > 3));
    const palavrasB = new Set(b.split(/\s+/).filter(p => p.length > 3));
    if (palavrasA.size === 0 || palavrasB.size === 0) return 0;
    let intersecao = 0;
    palavrasA.forEach(p => { if (palavrasB.has(p)) intersecao++; });
    const uniao = new Set([...palavrasA, ...palavrasB]).size;
    return intersecao / uniao;
}

const LIMITE_SIMILARIDADE = 0.6;

// ============================================================
// LISTA DE OVERRIDES: nomes fixos para sites específicos.
// Pode editar/adicionar linhas aqui livremente (chave = hostname sem "www.",
// valor = nome que deve aparecer como Fonte). Não precisa mexer em mais nada.
// ============================================================
const OVERRIDES_FONTE = {
    'g1.globo.com': 'G1 Globo',
    'camara.leg.br': 'Câmara dos Deputados',
    'jornaldocomercio.com': 'Jornal do Comércio'
};

// ============================================================
// LISTA DE SIGLAS CONHECIDAS: nomes que devem aparecer em CAIXA ALTA
// em vez de só a primeira letra maiúscula (ex: "usp" -> "USP", não "Usp").
// Pode adicionar novas siglas aqui livremente, uma por item, em minúsculas.
// ============================================================
const ESTADOS_BR = ['ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms',
    'mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','sp','se','to'];

const SIGLAS_CONHECIDAS = [
    ...ESTADOS_BR,
    ...ESTADOS_BR.map(uf => `tj${uf}`), // gera tjsp, tjrj, tjma, etc. automaticamente
    'usp', 'stf', 'stj', 'tst', 'tcu', 'cnj', 'mpf', 'mpu', 'inss'
];

// Sufixos de domínio de 2 partes comuns no Brasil (e alguns internacionais).
// Sem essa lista, "amazonas1.com.br" viraria "Com" (pega sempre a penúltima parte).
const SUFIXOS_DOMINIO_DUAS_PARTES = [
    'com.br', 'org.br', 'gov.br', 'net.br', 'jus.br', 'adv.br',
    'edu.br', 'mil.br', 'blog.br', 'info.br', 'ind.br',
    'co.uk', 'com.au', 'co.jp'
];

// Extrai nome amigável do domínio (ex: "amazonas1.com.br" → "Amazonas1")
function extrairNomeFonte(url) {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');

        // 1) Override exato tem prioridade sobre qualquer outra regra
        if (OVERRIDES_FONTE[hostname]) return OVERRIDES_FONTE[hostname];

        const partes = hostname.split('.');

        // 2) Regra especial UOL: qualquer subdomínio.uol.com.br -> "{Subdomínio} UOL"
        const indiceUol = partes.indexOf('uol');
        if (indiceUol > 0) {
            const antesDoUol = partes[indiceUol - 1];
            return `${antesDoUol.charAt(0).toUpperCase()}${antesDoUol.slice(1)} UOL`;
        }

        // 3) Extração normal, já considerando sufixos de 2 partes (.com.br, .jus.br etc.)
        const terminaEmSufixoDuasPartes = partes.length >= 3
            && SUFIXOS_DOMINIO_DUAS_PARTES.includes(partes.slice(-2).join('.'));

        const nome = terminaEmSufixoDuasPartes
            ? partes[partes.length - 3]
            : (partes.length >= 2 ? partes[partes.length - 2] : partes[0]);

        // 4) Se for uma sigla conhecida, devolve em CAIXA ALTA
        if (SIGLAS_CONHECIDAS.includes(nome.toLowerCase())) {
            return nome.toUpperCase();
        }

        return nome.charAt(0).toUpperCase() + nome.slice(1);
    } catch {
        return "Desconhecida";
    }
}

async function resolverUrlsOriginais(urls) {
    try {
        const resposta = await fetch("/api/resolve-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls })
        });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const data = await resposta.json();
        return data.resultados || [];
    } catch (err) {
        console.error("Erro ao resolver URLs:", err);
        return urls.map(url => ({ original: url, resolvido: url }));
    }
}

async function buscarFeedRSS() {
    const urlProvedor = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}&api_key=${RSS2JSON_API_KEY}&count=20`;
    
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {
            console.log(`Buscando RSS (tentativa ${tentativa}/${MAX_TENTATIVAS})...`);
            const resposta = await fetch(urlProvedor);
            if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
            const data = await resposta.json();
            if (!data || !data.items || data.items.length === 0) throw new Error("Feed vazio");
            return data;
        } catch (err) {
            console.warn(`Falha na tentativa ${tentativa}: ${err.message}`);
            if (tentativa < MAX_TENTATIVAS) {
                await new Promise(r => setTimeout(r, tentativa * 2000));
            } else {
                throw err;
            }
        }
    }
}

async function atualizarNoticiasDoRSS() {
    console.log("Iniciando busca de notícias...");
    
    try {
        const data = await buscarFeedRSS();
        
        const existentes = await obterTodasNoticias();
        const titulosConhecidos = existentes.map(n => normalizarTitulo(n.titulo));
        
        let novasNoticiasContador = 0;
        let duplicatasIgnoradas = 0;
        const noticiasNovas = [];
        
        for (const item of data.items) {
            const url = item.link || item.guid;
            if (!url) continue;
            
            const tituloNormalizado = normalizarTitulo(item.title);
            const jaExisteSimilar = titulosConhecidos.some(
                t => similaridadeTitulos(t, tituloNormalizado) >= LIMITE_SIMILARIDADE
            );
            
            if (jaExisteSimilar) {
                duplicatasIgnoradas++;
                continue;
            }
            
            noticiasNovas.push({
                url: url,
                titulo: item.title,
                snippet: item.description || item.content || "",
                fonte: item.author || "Google Notícias",
                dataPublicacao: Date.parse(item.pubDate) || Date.now(),
                categoria: "PENDENTE",
                relevancia: 0,
                resumoTexto: null
            });
            titulosConhecidos.push(tituloNormalizado);
        }
        
        if (noticiasNovas.length > 0) {
            console.log(`Resolvendo URLs de ${noticiasNovas.length} notícia(s) nova(s)...`);
            const urlsParaResolver = noticiasNovas.map(n => n.url);
            const resultados = await resolverUrlsOriginais(urlsParaResolver);
            
            // Atualiza URL resolvida E extrai fonte real do domínio
            resultados.forEach((resultado, indice) => {
                if (noticiasNovas[indice]) {
                    noticiasNovas[indice].url = resultado.resolvido;
                    
                    // ✅ CORREÇÃO: Se a URL foi resolvida (não é mais Google), atualiza a fonte
                    if (resultado.resolvido !== resultado.original && !resultado.resolvido.includes('news.google.com')) {
                        noticiasNovas[indice].fonte = extrairNomeFonte(resultado.resolvido);
                    }
                }
            });
            
            for (const noticia of noticiasNovas) {
                try {
                    await salvarNoticia(noticia);
                    novasNoticiasContador++;
                } catch (erroSalvamento) {
                    console.error(`Erro ao salvar "${noticia.titulo}":`, erroSalvamento);
                }
            }
        }
        
        console.log(`Processamento concluído: ${novasNoticiasContador} novos, ${duplicatasIgnoradas} duplicatas.`);
        return true;
        
    } catch (err) {
        console.error("Erro fatal ao buscar feed:", err);
        alert("[ERRO DE REDE]\nNão foi possível buscar as notícias.\nDetalhes: " + err.message);
        return false;
    }
}
